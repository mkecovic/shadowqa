import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { capturePage } from "../capture/index.js";
import { comparePages } from "../compare/index.js";
import { explainFindings } from "../explain/index.js";
import { buildHtmlReport } from "../report/index.js";
import type { ComparisonReport, CompareRequest } from "../types/index.js";

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

router.post("/api/compare", async (req: Request, res: Response) => {
  const { sourceUrl, targetUrl, viewport } = req.body as CompareRequest;

  if (!sourceUrl || !targetUrl) {
    res.status(400).json({ error: "Both sourceUrl and targetUrl are required" });
    return;
  }

  // Basic URL validation
  try {
    new URL(sourceUrl);
    new URL(targetUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  // Validate viewport if provided
  if (viewport && (typeof viewport.width !== "number" || typeof viewport.height !== "number")) {
    res.status(400).json({ error: "viewport must have numeric width and height" });
    return;
  }

  const jobId = crypto.randomUUID();
  activeJobs.set(jobId, { status: "capturing", progress: 0 });

  // Return job ID immediately
  res.json({ jobId });

  // Process in background
  processComparison(jobId, sourceUrl, targetUrl, viewport).catch((err) => {
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

router.get("/api/reports/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const reportPath = path.join(reportsDir, `${id}.html`);
  if (!fs.existsSync(reportPath)) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.sendFile(reportPath);
});

async function processComparison(
  jobId: string,
  sourceUrl: string,
  targetUrl: string,
  viewport?: { width: number; height: number }
): Promise<void> {
  // Step 1: Capture both pages in parallel
  activeJobs.set(jobId, { status: "Capturing pages...", progress: 5 });
  const [sourceCapture, targetCapture] = await Promise.all([
    capturePage(sourceUrl, viewport),
    capturePage(targetUrl, viewport),
  ]);
  activeJobs.set(jobId, { status: "Pages captured", progress: 40 });

  // Locales are auto-detected from <html lang> on each page
  const sourceLocale = sourceCapture.lang || undefined;
  const targetLocale = targetCapture.lang || undefined;

  // Step 3: Compare
  activeJobs.set(jobId, { status: "Comparing pages — analyzing localization...", progress: 45 });
  const { findings: rawFindings, diffImage, annotatedScreenshot } = await comparePages(
    sourceCapture,
    targetCapture
  );
  activeJobs.set(jobId, { status: "Analysis complete — scoring findings...", progress: 65 });

  // Step 4: Score and explain
  activeJobs.set(jobId, { status: "Scoring and explaining findings...", progress: 70 });
  const findings = explainFindings(rawFindings);

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, major: 1, normal: 2, minor: 3, trivial: 4 };
  findings.sort(
    (a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
  );

  // Step 5: Build report
  activeJobs.set(jobId, { status: "Generating HTML report...", progress: 85 });

  const usedViewport = sourceCapture.viewport;

  const report: ComparisonReport = {
    id: jobId,
    sourceUrl,
    targetUrl,
    sourceLocale,
    targetLocale,
    viewport: usedViewport,
    timestamp: new Date().toISOString(),
    summary: {
      critical: findings.filter((f) => f.severity === "critical").length,
      major: findings.filter((f) => f.severity === "major").length,
      normal: findings.filter((f) => f.severity === "normal").length,
      minor: findings.filter((f) => f.severity === "minor").length,
      trivial: findings.filter((f) => f.severity === "trivial").length,
      total: findings.length,
    },
    findings,
    sourceScreenshot: sourceCapture.screenshot.toString("base64"),
    targetScreenshot: targetCapture.screenshot.toString("base64"),
    diffScreenshot: diffImage.toString("base64"),
    annotatedScreenshot: annotatedScreenshot.toString("base64"),
  };

  const html = buildHtmlReport(report);
  fs.writeFileSync(path.join(reportsDir, `${jobId}.html`), html);

  // Save metadata for history listing
  const meta = {
    id: jobId,
    sourceUrl,
    targetUrl,
    sourceLocale,
    targetLocale,
    viewport: usedViewport,
    timestamp: report.timestamp,
    summary: report.summary,
  };
  fs.writeFileSync(path.join(reportsDir, `${jobId}.meta.json`), JSON.stringify(meta));

  activeJobs.set(jobId, { status: "complete", progress: 100 });
}

export default router;
