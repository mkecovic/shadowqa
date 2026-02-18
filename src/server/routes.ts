import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { processComparison } from "../compare/process.js";
import { BatchManager } from "../batch/index.js";
import { discoverPairs, discoverPairsFromSeparate } from "../batch/sitemap.js";
import type { CompareRequest } from "../types/index.js";

const router = Router();
const reportsDir = path.resolve(process.cwd(), "reports");

// Ensure reports directory exists
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// Track in-progress comparisons
const activeJobs = new Map<
  string,
  { status: string; progress: number; error?: string }
>();

// Batch manager (singleton)
const batchManager = new BatchManager(reportsDir);

// --- Single compare endpoints ---

router.post("/api/compare", async (req: Request, res: Response) => {
  const { sourceUrl, targetUrl, viewport } = req.body as CompareRequest;

  if (!sourceUrl || !targetUrl) {
    res.status(400).json({ error: "Both sourceUrl and targetUrl are required" });
    return;
  }

  try {
    new URL(sourceUrl);
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  if (viewport && (typeof viewport.width !== "number" || typeof viewport.height !== "number")) {
    res.status(400).json({ error: "viewport must have numeric width and height" });
    return;
  }

  const jobId = crypto.randomUUID();
  activeJobs.set(jobId, { status: "capturing", progress: 0 });

  res.json({ jobId });

  processComparison(
    sourceUrl,
    targetUrl,
    viewport,
    reportsDir,
    (status, progress) => {
      activeJobs.set(jobId, { status, progress });
    },
    jobId
  ).catch((err) => {
    console.error(`Job ${jobId} failed:`, err);
    activeJobs.set(jobId, {
      status: "error",
      progress: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

router.get("/api/status/:jobId", (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = activeJobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

// --- Report endpoints ---

router.get("/api/reports", (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".meta.json"));
    const reports = files
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(reportsDir, f), "utf-8");
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
    res.json(reports);
  } catch {
    res.json([]);
  }
});

router.delete("/api/reports/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const htmlPath = path.join(reportsDir, `${id}.html`);
  const metaPath = path.join(reportsDir, `${id}.meta.json`);
  if (!fs.existsSync(htmlPath) && !fs.existsSync(metaPath)) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  res.json({ ok: true });
});

// Bulk delete reports
router.delete("/api/reports", (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: string[] };

  try {
    let deleted = 0;
    if (ids && ids.length > 0) {
      // Delete specific reports
      for (const id of ids) {
        const htmlPath = path.join(reportsDir, `${id}.html`);
        const metaPath = path.join(reportsDir, `${id}.meta.json`);
        if (fs.existsSync(htmlPath)) { fs.unlinkSync(htmlPath); deleted++; }
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      }
    } else {
      // Delete all reports (not batch files)
      const files = fs.readdirSync(reportsDir);
      for (const f of files) {
        if (f.endsWith(".meta.json") && !f.endsWith(".batch.json")) {
          const id = f.replace(".meta.json", "");
          const htmlPath = path.join(reportsDir, `${id}.html`);
          if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
          fs.unlinkSync(path.join(reportsDir, f));
          deleted++;
        }
      }
    }
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete reports" });
  }
});

router.get("/api/reports/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const reportPath = path.join(reportsDir, `${id}.html`);
  if (!fs.existsSync(reportPath)) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.sendFile(reportPath);
});

// --- Batch endpoints ---

router.post("/api/batch", async (req: Request, res: Response) => {
  const { pairs, viewport } = req.body as {
    pairs: { sourceUrl: string; targetUrl: string }[];
    viewport?: { width: number; height: number };
  };

  if (!pairs || !Array.isArray(pairs) || pairs.length === 0) {
    res.status(400).json({ error: "pairs array is required and must not be empty" });
    return;
  }

  if (pairs.length > 100) {
    res.status(400).json({ error: "Maximum 100 URL pairs per batch" });
    return;
  }

  // Validate all URLs
  for (const pair of pairs) {
    if (!pair.sourceUrl || !pair.targetUrl) {
      res.status(400).json({ error: "Each pair must have sourceUrl and targetUrl" });
      return;
    }
    try {
      new URL(pair.sourceUrl);
      new URL(pair.targetUrl);
    } catch {
      res.status(400).json({
        error: `Invalid URL format: ${pair.sourceUrl} or ${pair.targetUrl}`,
      });
      return;
    }
  }

  const vp = viewport || { width: 1280, height: 720 };
  const batch = batchManager.createBatch(pairs, vp);

  res.json({ batchId: batch.id });

  // Start processing in background
  batchManager.startBatch(batch.id);
});

router.get("/api/batch/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const meta = batchManager.getBatch(id);
  if (!meta) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json(meta);
});

router.get("/api/batches", (_req: Request, res: Response) => {
  const batches = batchManager.listBatches(10);
  res.json(batches);
});

// Delete single batch
router.delete("/api/batches/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const deleted = batchManager.deleteBatch(id);
  if (!deleted) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json({ ok: true });
});

// Bulk delete batches
router.delete("/api/batches", (req: Request, res: Response) => {
  const { ids } = req.body as { ids?: string[] };

  try {
    let deleted = 0;
    if (ids && ids.length > 0) {
      for (const id of ids) {
        if (batchManager.deleteBatch(id)) deleted++;
      }
    } else {
      // Delete all batches
      const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".batch.json"));
      for (const f of files) {
        const id = f.replace(".batch.json", "");
        if (batchManager.deleteBatch(id)) deleted++;
      }
    }
    res.json({ ok: true, deleted });
  } catch {
    res.status(500).json({ error: "Failed to delete batches" });
  }
});

router.get("/api/batch/:id/summary", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const meta = batchManager.getBatch(id);
  if (!meta) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  if (!meta.summaryReportId) {
    res.status(404).json({ error: "Summary report not yet generated" });
    return;
  }
  const reportPath = path.join(reportsDir, `${meta.summaryReportId}.html`);
  if (!fs.existsSync(reportPath)) {
    res.status(404).json({ error: "Summary report file not found" });
    return;
  }
  res.sendFile(reportPath);
});

// --- Sitemap discovery endpoint ---

router.post("/api/sitemap/discover", async (req: Request, res: Response) => {
  const { sitemapUrl, targetSitemapUrl, sourceLocale, targetLocale } = req.body as {
    sitemapUrl: string;
    targetSitemapUrl?: string;
    sourceLocale: string;
    targetLocale: string;
  };

  if (!sitemapUrl || !sourceLocale || !targetLocale) {
    res.status(400).json({
      error: "sitemapUrl, sourceLocale, and targetLocale are required",
    });
    return;
  }

  try {
    new URL(sitemapUrl);
  } catch {
    res.status(400).json({ error: "Invalid source sitemap URL format" });
    return;
  }

  if (targetSitemapUrl) {
    try {
      new URL(targetSitemapUrl);
    } catch {
      res.status(400).json({ error: "Invalid target sitemap URL format" });
      return;
    }
  }

  try {
    let pairs;
    if (targetSitemapUrl) {
      pairs = await discoverPairsFromSeparate(sitemapUrl, targetSitemapUrl, sourceLocale, targetLocale);
    } else {
      pairs = await discoverPairs(sitemapUrl, sourceLocale, targetLocale);
    }
    res.json({ pairs });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to parse sitemap",
    });
  }
});

export default router;
export { reportsDir, activeJobs };
