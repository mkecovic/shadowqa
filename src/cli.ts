import crypto from "crypto";
import fs from "fs";
import path from "path";
import { closeBrowser } from "./capture/index.js";
import { processComparison } from "./compare/process.js";
import { AsyncQueue } from "./batch/queue.js";
import { buildBatchSummaryReport } from "./report/summary.js";
import { discoverPairs, discoverPairsFromSeparate } from "./batch/sitemap.js";
import type { BatchMeta } from "./batch/types.js";

const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

type Mode =
  | { type: "single"; sourceUrl: string; targetUrl: string }
  | { type: "batch"; csvPath: string }
  | { type: "sitemap"; sitemapUrl: string; targetSitemapUrl?: string; sourceLocale: string; targetLocale: string };

interface CliArgs {
  mode: Mode;
  viewport: { width: number; height: number };
  output: string;
}

function printHelp(): void {
  console.log(`
Shadow QA — Localization QA CLI

Usage:
  shadowqa <sourceUrl> <targetUrl> [options]
  shadowqa --batch <file.csv> [options]
  shadowqa --sitemap <url> --source-locale <loc> --target-locale <loc> [options]
  shadowqa --sitemap <src-url> --target-sitemap <tgt-url> --target-locale <loc> [options]

Options:
  --viewport <preset|WxH>   Viewport size (default: desktop)
                             Presets: desktop (1280x720), tablet (768x1024), mobile (375x667)
                             Custom: WxH (e.g. 1440x900)
  --output <path>            Output directory (default: ./reports)
  --batch <file.csv>         Batch compare from CSV file
  --sitemap <url>            Discover pairs from sitemap XML (source sitemap when using --target-sitemap)
  --target-sitemap <url>     Target language sitemap (for separate sitemaps per language)
  --source-locale <locale>   Source locale for sitemap (default: en)
  --target-locale <locale>   Target locale for sitemap
  --help                     Show this help message

Examples:
  shadowqa https://example.com https://example.com/de
  shadowqa https://example.com https://example.com/ja --viewport mobile
  shadowqa --batch urls.csv --viewport desktop
  shadowqa --sitemap https://example.com/sitemap.xml --source-locale en --target-locale de
  shadowqa --sitemap https://example.com/sitemap-en.xml --target-sitemap https://example.com/sitemap-de.xml --target-locale de
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  let viewport = VIEWPORT_PRESETS.desktop;
  let output = "./reports";
  let batchPath: string | null = null;
  let sitemapUrl: string | null = null;
  let targetSitemapUrl: string | null = null;
  let sourceLocale = "en";
  let targetLocale: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--viewport") {
      i++;
      const val = args[i];
      if (!val) {
        console.error("Error: --viewport requires a value");
        process.exit(1);
      }
      if (VIEWPORT_PRESETS[val]) {
        viewport = VIEWPORT_PRESETS[val];
      } else if (/^\d+x\d+$/.test(val)) {
        const [w, h] = val.split("x").map(Number);
        viewport = { width: w, height: h };
      } else {
        console.error(`Error: Invalid viewport "${val}". Use a preset (desktop, tablet, mobile) or WxH format (e.g. 1440x900)`);
        process.exit(1);
      }
    } else if (args[i] === "--output") {
      i++;
      if (!args[i]) {
        console.error("Error: --output requires a path");
        process.exit(1);
      }
      output = args[i];
    } else if (args[i] === "--batch") {
      i++;
      if (!args[i]) {
        console.error("Error: --batch requires a CSV file path");
        process.exit(1);
      }
      batchPath = args[i];
    } else if (args[i] === "--sitemap") {
      i++;
      if (!args[i]) {
        console.error("Error: --sitemap requires a URL");
        process.exit(1);
      }
      sitemapUrl = args[i];
    } else if (args[i] === "--target-sitemap") {
      i++;
      if (!args[i]) {
        console.error("Error: --target-sitemap requires a URL");
        process.exit(1);
      }
      targetSitemapUrl = args[i];
    } else if (args[i] === "--source-locale") {
      i++;
      if (!args[i]) {
        console.error("Error: --source-locale requires a value");
        process.exit(1);
      }
      sourceLocale = args[i];
    } else if (args[i] === "--target-locale") {
      i++;
      if (!args[i]) {
        console.error("Error: --target-locale requires a value");
        process.exit(1);
      }
      targetLocale = args[i];
    } else if (args[i] === "--help") {
      printHelp();
      process.exit(0);
    } else if (args[i].startsWith("--")) {
      console.error(`Error: Unknown option "${args[i]}"`);
      process.exit(1);
    } else {
      positional.push(args[i]);
    }
  }

  // Determine mode
  if (batchPath) {
    return { mode: { type: "batch", csvPath: batchPath }, viewport, output };
  }

  if (sitemapUrl) {
    if (!targetLocale) {
      console.error("Error: --target-locale is required when using --sitemap");
      process.exit(1);
    }
    return {
      mode: { type: "sitemap", sitemapUrl, targetSitemapUrl: targetSitemapUrl || undefined, sourceLocale, targetLocale },
      viewport,
      output,
    };
  }

  // Single compare mode
  if (positional.length < 2) {
    console.error("Error: Both sourceUrl and targetUrl are required");
    console.error('Run "shadowqa --help" for usage');
    process.exit(1);
  }

  for (const url of [positional[0], positional[1]]) {
    try {
      new URL(url);
    } catch {
      console.error(`Error: Invalid URL "${url}"`);
      process.exit(1);
    }
  }

  return {
    mode: { type: "single", sourceUrl: positional[0], targetUrl: positional[1] },
    viewport,
    output,
  };
}

function parseCsvFile(filePath: string): { sourceUrl: string; targetUrl: string }[] {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Error: File not found: ${absPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absPath, "utf-8");
  const lines = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  // Skip header if present
  if (lines.length > 0 && (lines[0].toLowerCase().includes("source") || lines[0].toLowerCase().includes("url"))) {
    lines.shift();
  }

  const pairs: { sourceUrl: string; targetUrl: string }[] = [];
  for (const line of lines) {
    const parts = line.split(/[,\t|]/).map((s) => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      try {
        new URL(parts[0]);
        new URL(parts[1]);
        pairs.push({ sourceUrl: parts[0], targetUrl: parts[1] });
      } catch {
        console.warn(`Skipping invalid URL pair: ${parts[0]}, ${parts[1]}`);
      }
    }
  }

  return pairs;
}

async function runSingle(
  sourceUrl: string,
  targetUrl: string,
  viewport: { width: number; height: number },
  outputDir: string
): Promise<void> {
  console.log(`Capturing source: ${sourceUrl}`);
  console.log(`Capturing target: ${targetUrl}`);
  console.log(`Viewport: ${viewport.width}x${viewport.height}`);
  console.log();

  const result = await processComparison(
    sourceUrl,
    targetUrl,
    viewport,
    outputDir,
    (status) => {
      console.log(status);
    }
  );

  console.log();
  console.log(`Report: ${path.join(outputDir, `${result.reportId}.html`)}`);
  console.log(`Findings: ${result.report.summary.total} total`);
  if (result.report.summary.critical > 0) console.log(`  Critical: ${result.report.summary.critical}`);
  if (result.report.summary.major > 0) console.log(`  Major: ${result.report.summary.major}`);
  if (result.report.summary.normal > 0) console.log(`  Normal: ${result.report.summary.normal}`);
  if (result.report.summary.minor > 0) console.log(`  Minor: ${result.report.summary.minor}`);
  if (result.report.summary.trivial > 0) console.log(`  Trivial: ${result.report.summary.trivial}`);
}

async function runBatch(
  pairs: { sourceUrl: string; targetUrl: string }[],
  viewport: { width: number; height: number },
  outputDir: string
): Promise<void> {
  console.log(`Starting batch: ${pairs.length} URL pairs`);
  console.log(`Viewport: ${viewport.width}x${viewport.height}`);
  console.log(`Concurrency: 3`);
  console.log();

  const queue = new AsyncQueue(3);
  const batchId = crypto.randomUUID();
  const results: {
    sourceUrl: string;
    targetUrl: string;
    status: "complete" | "error";
    reportId?: string;
    error?: string;
    summary?: { critical: number; major: number; normal: number; minor: number; trivial: number; total: number };
  }[] = [];

  let completed = 0;

  const jobs = pairs.map((pair, idx) =>
    queue.add(async () => {
      const num = idx + 1;
      console.log(`[${num}/${pairs.length}] Comparing ${pair.sourceUrl} vs ${pair.targetUrl}`);

      try {
        const result = await processComparison(
          pair.sourceUrl,
          pair.targetUrl,
          viewport,
          outputDir,
          () => {} // silent progress for batch
        );

        completed++;
        console.log(`[${num}/${pairs.length}] Complete (${completed}/${pairs.length} done)`);

        results.push({
          sourceUrl: pair.sourceUrl,
          targetUrl: pair.targetUrl,
          status: "complete",
          reportId: result.reportId,
          summary: result.report.summary,
        });
      } catch (err) {
        completed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${num}/${pairs.length}] Error: ${msg}`);

        results.push({
          sourceUrl: pair.sourceUrl,
          targetUrl: pair.targetUrl,
          status: "error",
          error: msg,
        });
      }
    })
  );

  await Promise.allSettled(jobs);

  // Generate summary report
  const completedResults = results.filter((r) => r.status === "complete");
  const failedResults = results.filter((r) => r.status === "error");

  const batchMeta: BatchMeta = {
    id: batchId,
    status: failedResults.length > 0 ? "error" : "complete",
    viewport,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    totalJobs: pairs.length,
    completedJobs: completedResults.length,
    failedJobs: failedResults.length,
    jobs: results.map((r, i) => ({
      jobId: crypto.randomUUID(),
      sourceUrl: r.sourceUrl,
      targetUrl: r.targetUrl,
      status: r.status,
      progress: 100,
      reportId: r.reportId,
      error: r.error,
    })),
  };

  // Load individual metas for summary report
  const individualMetas: any[] = [];
  for (const r of completedResults) {
    if (r.reportId) {
      const metaPath = path.join(outputDir, `${r.reportId}.meta.json`);
      if (fs.existsSync(metaPath)) {
        try {
          individualMetas.push(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
        } catch {
          // skip
        }
      }
    }
  }

  const summaryHtml = buildBatchSummaryReport(batchMeta, individualMetas);
  const summaryPath = path.join(outputDir, `${batchId}-summary.html`);
  fs.writeFileSync(summaryPath, summaryHtml);

  // Save batch meta
  fs.writeFileSync(
    path.join(outputDir, `${batchId}.batch.json`),
    JSON.stringify(batchMeta)
  );

  // Print summary table
  console.log();
  console.log("=".repeat(60));
  console.log("BATCH SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total:     ${pairs.length}`);
  console.log(`Complete:  ${completedResults.length}`);
  console.log(`Failed:    ${failedResults.length}`);
  console.log();

  // Aggregate findings
  let totalFindings = 0;
  const severities = { critical: 0, major: 0, normal: 0, minor: 0, trivial: 0 };
  for (const r of completedResults) {
    if (r.summary) {
      totalFindings += r.summary.total;
      severities.critical += r.summary.critical;
      severities.major += r.summary.major;
      severities.normal += r.summary.normal;
      severities.minor += r.summary.minor;
      severities.trivial += r.summary.trivial;
    }
  }

  console.log(`Total findings: ${totalFindings}`);
  if (severities.critical > 0) console.log(`  Critical: ${severities.critical}`);
  if (severities.major > 0) console.log(`  Major: ${severities.major}`);
  if (severities.normal > 0) console.log(`  Normal: ${severities.normal}`);
  if (severities.minor > 0) console.log(`  Minor: ${severities.minor}`);
  if (severities.trivial > 0) console.log(`  Trivial: ${severities.trivial}`);
  console.log();
  console.log(`Summary report: ${summaryPath}`);

  if (failedResults.length > 0) {
    console.log();
    console.log("Failed pages:");
    for (const r of failedResults) {
      console.log(`  ${r.sourceUrl} -> ${r.targetUrl}: ${r.error}`);
    }
  }
}

async function main(): Promise<void> {
  const { mode, viewport, output } = parseArgs(process.argv);

  const outputDir = path.resolve(output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    if (mode.type === "single") {
      await runSingle(mode.sourceUrl, mode.targetUrl, viewport, outputDir);
    } else if (mode.type === "batch") {
      const pairs = parseCsvFile(mode.csvPath);
      if (pairs.length === 0) {
        console.error("Error: No valid URL pairs found in CSV file");
        process.exit(1);
      }
      await runBatch(pairs, viewport, outputDir);
    } else if (mode.type === "sitemap") {
      if (mode.targetSitemapUrl) {
        console.log(`Discovering pairs from separate sitemaps:`);
        console.log(`  Source: ${mode.sitemapUrl}`);
        console.log(`  Target: ${mode.targetSitemapUrl}`);
      } else {
        console.log(`Discovering pairs from sitemap: ${mode.sitemapUrl}`);
      }
      console.log(`Locales: ${mode.sourceLocale} -> ${mode.targetLocale}`);
      console.log();

      const pairs = mode.targetSitemapUrl
        ? await discoverPairsFromSeparate(
            mode.sitemapUrl,
            mode.targetSitemapUrl,
            mode.sourceLocale,
            mode.targetLocale
          )
        : await discoverPairs(
            mode.sitemapUrl,
            mode.sourceLocale,
            mode.targetLocale
          );

      console.log(`Found ${pairs.length} URL pairs`);
      console.log();

      await runBatch(
        pairs.map((p) => ({ sourceUrl: p.sourceUrl, targetUrl: p.targetUrl })),
        viewport,
        outputDir
      );
    }
  } finally {
    await closeBrowser();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  closeBrowser().finally(() => process.exit(1));
});
