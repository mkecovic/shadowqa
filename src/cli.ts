import crypto from "crypto";
import fs from "fs";
import path from "path";
import { capturePage, closeBrowser } from "./capture/index.js";
import { comparePages } from "./compare/index.js";
import { explainFindings } from "./explain/index.js";
import { buildHtmlReport } from "./report/index.js";
import type { ComparisonReport } from "./types/index.js";

const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

function printHelp(): void {
  console.log(`
Shadow QA — Localization QA CLI

Usage:
  shadowqa <sourceUrl> <targetUrl> [options]

Options:
  --viewport <preset|WxH>   Viewport size (default: desktop)
                             Presets: desktop (1280x720), tablet (768x1024), mobile (375x667)
                             Custom: WxH (e.g. 1440x900)
  --output <path>            Output directory (default: ./reports)
  --help                     Show this help message

Examples:
  shadowqa https://example.com https://example.com/de
  shadowqa https://example.com https://example.com/ja --viewport mobile
  shadowqa https://example.com https://example.com/fr --viewport 1440x900
  shadowqa https://example.com https://example.com/es --output ./my-reports
`);
}

function parseArgs(argv: string[]): {
  sourceUrl: string;
  targetUrl: string;
  viewport: { width: number; height: number };
  output: string;
} {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  let viewport = VIEWPORT_PRESETS.desktop;
  let output = "./reports";
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

  if (positional.length < 2) {
    console.error("Error: Both sourceUrl and targetUrl are required");
    console.error('Run "shadowqa --help" for usage');
    process.exit(1);
  }

  // Validate URLs
  for (const url of [positional[0], positional[1]]) {
    try {
      new URL(url);
    } catch {
      console.error(`Error: Invalid URL "${url}"`);
      process.exit(1);
    }
  }

  return {
    sourceUrl: positional[0],
    targetUrl: positional[1],
    viewport,
    output,
  };
}

async function main(): Promise<void> {
  const { sourceUrl, targetUrl, viewport, output } = parseArgs(process.argv);

  const outputDir = path.resolve(output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Step 1: Capture both pages
    console.log(`Capturing source: ${sourceUrl}`);
    console.log(`Capturing target: ${targetUrl}`);
    console.log(`Viewport: ${viewport.width}x${viewport.height}`);
    console.log();

    const [sourceCapture, targetCapture] = await Promise.all([
      capturePage(sourceUrl, viewport),
      capturePage(targetUrl, viewport),
    ]);
    console.log("Pages captured.");

    // Step 2: Compare
    console.log("Analyzing localization differences...");
    const { findings: rawFindings, diffImage } = await comparePages(
      sourceCapture,
      targetCapture
    );

    // Step 3: Score and explain
    console.log("Scoring findings...");
    const findings = explainFindings(rawFindings);

    const severityOrder: Record<string, number> = {
      critical: 0,
      major: 1,
      minor: 2,
      warning: 3,
      cosmetic: 4,
    };
    findings.sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
    );

    // Step 4: Build report
    const reportId = crypto.randomUUID();
    const sourceLocale = sourceCapture.lang || undefined;
    const targetLocale = targetCapture.lang || undefined;

    const report: ComparisonReport = {
      id: reportId,
      sourceUrl,
      targetUrl,
      sourceLocale,
      targetLocale,
      viewport: sourceCapture.viewport,
      timestamp: new Date().toISOString(),
      summary: {
        critical: findings.filter((f) => f.severity === "critical").length,
        major: findings.filter((f) => f.severity === "major").length,
        minor: findings.filter((f) => f.severity === "minor").length,
        warning: findings.filter((f) => f.severity === "warning").length,
        cosmetic: findings.filter((f) => f.severity === "cosmetic").length,
        total: findings.length,
      },
      findings,
      sourceScreenshot: sourceCapture.screenshot.toString("base64"),
      targetScreenshot: targetCapture.screenshot.toString("base64"),
      diffScreenshot: diffImage.toString("base64"),
    };

    const html = buildHtmlReport(report);
    const reportPath = path.join(outputDir, `${reportId}.html`);
    fs.writeFileSync(reportPath, html);

    // Print summary
    console.log();
    console.log(`Report: ${reportPath}`);
    console.log(`Findings: ${report.summary.total} total`);
    if (report.summary.critical > 0) console.log(`  Critical: ${report.summary.critical}`);
    if (report.summary.major > 0) console.log(`  Major: ${report.summary.major}`);
    if (report.summary.minor > 0) console.log(`  Minor: ${report.summary.minor}`);
    if (report.summary.warning > 0) console.log(`  Warning: ${report.summary.warning}`);
    if (report.summary.cosmetic > 0) console.log(`  Cosmetic: ${report.summary.cosmetic}`);
  } finally {
    await closeBrowser();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  closeBrowser().finally(() => process.exit(1));
});
