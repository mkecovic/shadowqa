import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import { processComparison } from "../compare/process.js";
import { BatchManager } from "../batch/index.js";
import { discoverPairs, discoverPairsFromSeparate } from "../batch/sitemap.js";
import { buildCodeDiffReport } from "../report/codeDiff.js";
import type { CompareRequest } from "../types/index.js";

function fetchUrl(url: string): Promise<{ body: string; contentType: string | null }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const client = isHttps ? https : http;
    const options = isHttps && isLocalhost ? { rejectUnauthorized: false } : {};
    const req = client.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf-8"),
          contentType: res.headers["content-type"] || null,
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

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

const MAX_CONCURRENT_SINGLE_JOBS = 5;
let activeSingleJobCount = 0;

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

  if (activeSingleJobCount >= MAX_CONCURRENT_SINGLE_JOBS) {
    res.status(429).json({ error: "Too many concurrent comparisons. Please wait for an existing job to finish." });
    return;
  }

  const jobId = crypto.randomUUID();
  activeJobs.set(jobId, { status: "capturing", progress: 0 });
  activeSingleJobCount++;

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
  }).finally(() => {
    activeSingleJobCount--;
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

router.get("/api/reports", (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10) || 10, 100);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

    const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".meta.json") && !f.endsWith(".batch.json"));
    const allReports = files
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(reportsDir, f), "utf-8");
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const page = allReports.slice(offset, offset + limit);
    res.json({ reports: page, total: allReports.length, offset, limit });
  } catch {
    res.json({ reports: [], total: 0, offset: 0, limit: 20 });
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

// --- Code compare endpoints ---

router.post("/api/code-compare/fetch", async (req: Request, res: Response) => {
  const { sourceUrl, targetUrl } = req.body as {
    sourceUrl: string;
    targetUrl: string;
  };

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

  try {
    const [sourceResult, targetResult] = await Promise.all([
      fetchUrl(sourceUrl),
      fetchUrl(targetUrl),
    ]);

    const sourceCode = sourceResult.body;
    const targetCode = targetResult.body;

    // Auto-detect language from Content-Type or URL extension
    const detectLang = (url: string, contentType: string | null): string => {
      const ct = (contentType || "").toLowerCase();
      if (ct.includes("json")) return "JSON";
      if (ct.includes("javascript")) return "JavaScript";
      if (ct.includes("css")) return "CSS";
      if (ct.includes("html") || ct.includes("xml")) {
        if (ct.includes("xml")) return "XML";
        return "HTML";
      }

      const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
      const extMap: Record<string, string> = {
        json: "JSON", js: "JavaScript", ts: "JavaScript",
        css: "CSS", html: "HTML", htm: "HTML",
        xml: "XML", svg: "XML", txt: "Plain Text",
        md: "Plain Text", yaml: "Plain Text", yml: "Plain Text",
      };
      return extMap[ext || ""] || "Plain Text";
    };

    const language = detectLang(sourceUrl, sourceResult.contentType);

    res.json({ sourceCode, targetCode, language });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to fetch URLs",
    });
  }
});

router.post("/api/code-compare", (req: Request, res: Response) => {
  const { sourceCode, targetCode, language, sourceLabel, targetLabel } = req.body as {
    sourceCode: string;
    targetCode: string;
    language?: string;
    sourceLabel?: string;
    targetLabel?: string;
  };

  if (sourceCode == null || targetCode == null) {
    res.status(400).json({ error: "Both sourceCode and targetCode are required" });
    return;
  }

  const reportId = crypto.randomUUID();
  const lang = language || "Plain Text";
  const srcLabel = sourceLabel || "Source";
  const tgtLabel = targetLabel || "Target";

  const html = buildCodeDiffReport(reportId, sourceCode, targetCode, lang, srcLabel, tgtLabel);

  fs.writeFileSync(path.join(reportsDir, `${reportId}.html`), html);
  fs.writeFileSync(
    path.join(reportsDir, `${reportId}.meta.json`),
    JSON.stringify({
      id: reportId,
      type: "code-diff",
      language: lang,
      sourceLabel: srcLabel,
      targetLabel: tgtLabel,
      timestamp: new Date().toISOString(),
    })
  );

  res.json({ reportId });
});

export default router;
export { reportsDir, activeJobs };
