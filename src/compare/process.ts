import crypto from "crypto";
import fs from "fs";
import path from "path";
import { capturePage } from "../capture/index.js";
import { comparePages } from "./index.js";
import { explainFindings } from "../explain/index.js";
import { buildHtmlReport } from "../report/index.js";
import type { ComparisonReport } from "../types/index.js";

export interface ProcessResult {
  reportId: string;
  report: ComparisonReport;
}

export type ProgressCallback = (status: string, progress: number) => void;

export async function processComparison(
  sourceUrl: string,
  targetUrl: string,
  viewport: { width: number; height: number } | undefined,
  reportsDir: string,
  onProgress: ProgressCallback,
  jobId?: string
): Promise<ProcessResult> {
  const reportId = jobId || crypto.randomUUID();

  // Step 1: Capture both pages in parallel
  onProgress("Capturing pages...", 5);
  const [sourceCapture, targetCapture] = await Promise.all([
    capturePage(sourceUrl, viewport),
    capturePage(targetUrl, viewport),
  ]);
  onProgress("Pages captured", 40);

  const sourceLocale = sourceCapture.lang || undefined;
  const targetLocale = targetCapture.lang || undefined;

  // Step 2: Compare
  onProgress("Comparing pages — analyzing localization...", 45);
  const { findings: rawFindings, diffImage, annotatedScreenshot } =
    await comparePages(sourceCapture, targetCapture);
  onProgress("Analysis complete — scoring findings...", 65);

  // Step 3: Score and explain
  onProgress("Scoring and explaining findings...", 70);
  const findings = explainFindings(rawFindings);

  const severityOrder: Record<string, number> = {
    critical: 0,
    major: 1,
    normal: 2,
    minor: 3,
    trivial: 4,
  };
  findings.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
  );

  // Step 4: Build report
  onProgress("Generating HTML report...", 85);
  const usedViewport = sourceCapture.viewport;

  const report: ComparisonReport = {
    id: reportId,
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
  };

  const html = buildHtmlReport(report);

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save screenshots as separate files (keeps HTML reports small)
  fs.writeFileSync(path.join(reportsDir, `${reportId}-source.png`), sourceCapture.screenshot);
  fs.writeFileSync(path.join(reportsDir, `${reportId}-target.png`), targetCapture.screenshot);
  fs.writeFileSync(path.join(reportsDir, `${reportId}-diff.png`), diffImage);
  fs.writeFileSync(path.join(reportsDir, `${reportId}-annotated.png`), annotatedScreenshot);

  fs.writeFileSync(path.join(reportsDir, `${reportId}.html`), html);

  const meta = {
    id: reportId,
    sourceUrl,
    targetUrl,
    sourceLocale,
    targetLocale,
    viewport: usedViewport,
    timestamp: report.timestamp,
    summary: report.summary,
  };
  fs.writeFileSync(
    path.join(reportsDir, `${reportId}.meta.json`),
    JSON.stringify(meta)
  );

  onProgress("complete", 100);

  return { reportId, report };
}
