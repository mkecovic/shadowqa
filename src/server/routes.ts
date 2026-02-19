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

// --- Job file persistence helpers ---

function jobFilePath(jobId: string): string {
  return path.join(reportsDir, `${jobId}.job.json`);
}

function saveJobFile(jobId: string, state: { status: string; progress: number; error?: string }): void {
  try {
    fs.writeFileSync(jobFilePath(jobId), JSON.stringify(state));
  } catch { /* non-fatal */ }
}

function deleteJobFile(jobId: string): void {
  try {
    const p = jobFilePath(jobId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* non-fatal */ }
}

// On startup: recover any .job.json files left from a previous server instance.
// Jobs that were still running when the server died are marked as errored.
try {
  for (const f of fs.readdirSync(reportsDir).filter((f) => f.endsWith(".job.json"))) {
    const jobId = f.replace(".job.json", "");
    try {
      const state = JSON.parse(fs.readFileSync(path.join(reportsDir, f), "utf-8"));
      if (state.status !== "complete" && state.status !== "error") {
        state.status = "error";
        state.error = "Job interrupted — server was restarted";
        saveJobFile(jobId, state);
      }
      activeJobs.set(jobId, state);
    } catch { /* skip corrupted files */ }
  }
} catch { /* reportsDir may not exist yet */ }

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
  const initialState = { status: "capturing", progress: 0 };
  activeJobs.set(jobId, initialState);
  saveJobFile(jobId, initialState);
  activeSingleJobCount++;

  res.json({ jobId });

  processComparison(
    sourceUrl,
    targetUrl,
    viewport,
    reportsDir,
    (status, progress) => {
      const state = { status, progress };
      activeJobs.set(jobId, state);
      saveJobFile(jobId, state);
    },
    jobId
  ).then(() => {
    // Success — .meta.json now exists on disk; job file is no longer needed
    deleteJobFile(jobId);
  }).catch((err) => {
    console.error(`Job ${jobId} failed:`, err);
    const errorState = {
      status: "error",
      progress: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    activeJobs.set(jobId, errorState);
    saveJobFile(jobId, errorState);
  }).finally(() => {
    activeSingleJobCount--;
  });
});

router.get("/api/status/:jobId", (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;

  // 1. In-memory (job is actively running or recently finished)
  const job = activeJobs.get(jobId);
  if (job) { res.json(job); return; }

  // 2. Report meta exists — job completed successfully in a previous session
  if (fs.existsSync(path.join(reportsDir, `${jobId}.meta.json`))) {
    res.json({ status: "complete", progress: 100 });
    return;
  }

  // 3. Job file exists — job errored or was interrupted in a previous session
  const jfp = jobFilePath(jobId);
  if (fs.existsSync(jfp)) {
    try {
      res.json(JSON.parse(fs.readFileSync(jfp, "utf-8")));
      return;
    } catch { /* fall through to 404 */ }
  }

  res.status(404).json({ error: "Job not found" });
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

const SCREENSHOT_TYPES = ["source", "target", "diff", "annotated"] as const;

function deleteReportFiles(id: string): void {
  const htmlPath = path.join(reportsDir, `${id}.html`);
  const metaPath = path.join(reportsDir, `${id}.meta.json`);
  if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  for (const type of SCREENSHOT_TYPES) {
    const pngPath = path.join(reportsDir, `${id}-${type}.png`);
    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
  }
}

router.delete("/api/reports/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const htmlPath = path.join(reportsDir, `${id}.html`);
  const metaPath = path.join(reportsDir, `${id}.meta.json`);
  if (!fs.existsSync(htmlPath) && !fs.existsSync(metaPath)) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  deleteReportFiles(id);
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
        const metaPath = path.join(reportsDir, `${id}.meta.json`);
        if (fs.existsSync(metaPath)) {
          deleteReportFiles(id);
          deleted++;
        }
      }
    } else {
      // Delete all reports (not batch files)
      const files = fs.readdirSync(reportsDir);
      for (const f of files) {
        if (f.endsWith(".meta.json") && !f.endsWith(".batch.json")) {
          const id = f.replace(".meta.json", "");
          deleteReportFiles(id);
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
    res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Report not found — Shadow QA</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
    .container { text-align: center; padding: 2rem; max-width: 400px; }
    .icon { width: 56px; height: 56px; border-radius: 50%; background: rgba(239,68,68,0.15); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem; }
    .icon svg { display: block; }
    h1 { font-size: 1.4rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { color: #94a3b8; margin: 0 0 1.75rem; line-height: 1.6; }
    a { display: inline-block; padding: 0.65rem 1.5rem; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-decoration: none; border-radius: 8px; font-size: 0.9rem; font-weight: 500; }
    a:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
      </svg>
    </div>
    <h1>Report not found</h1>
    <p>This report may have been deleted or the link has expired.</p>
    <a href="/">Back to Shadow QA</a>
  </div>
</body>
</html>`);
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

router.post("/api/batch/:id/retry", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const meta = batchManager.getBatch(id);
  if (!meta) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  const failedPairs = meta.jobs
    .filter((j) => j.status === "error")
    .map((j) => ({ sourceUrl: j.sourceUrl, targetUrl: j.targetUrl }));

  if (failedPairs.length === 0) {
    res.status(400).json({ error: "No failed jobs to retry" });
    return;
  }

  const newBatch = batchManager.createBatch(failedPairs, meta.viewport);
  res.json({ batchId: newBatch.id });
  batchManager.startBatch(newBatch.id);
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
