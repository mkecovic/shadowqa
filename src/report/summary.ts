import type { BatchMeta } from "../batch/types.js";

interface ReportMeta {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  sourceLocale?: string;
  targetLocale?: string;
  viewport: { width: number; height: number };
  timestamp: string;
  summary: {
    critical: number;
    major: number;
    normal: number;
    minor: number;
    trivial: number;
    total: number;
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildBatchSummaryReport(
  batch: BatchMeta,
  individualMetas: ReportMeta[]
): string {
  // Aggregate severity counts
  const totals = { critical: 0, major: 0, normal: 0, minor: 0, trivial: 0, total: 0 };
  for (const meta of individualMetas) {
    totals.critical += meta.summary.critical;
    totals.major += meta.summary.major;
    totals.normal += meta.summary.normal;
    totals.minor += meta.summary.minor;
    totals.trivial += meta.summary.trivial;
    totals.total += meta.summary.total;
  }

  // Build per-page rows
  const pageRows = batch.jobs
    .map((job) => {
      const meta = individualMetas.find((m) => m.id === job.reportId);
      const statusClass =
        job.status === "complete"
          ? "status-complete"
          : job.status === "error"
            ? "status-error"
            : "status-pending";

      const counts = meta
        ? `<td class="count count-critical">${meta.summary.critical || ""}</td>
           <td class="count count-major">${meta.summary.major || ""}</td>
           <td class="count count-normal">${meta.summary.normal || ""}</td>
           <td class="count count-minor">${meta.summary.minor || ""}</td>
           <td class="count count-trivial">${meta.summary.trivial || ""}</td>
           <td class="count count-total">${meta.summary.total}</td>`
        : `<td colspan="6" class="no-data">${job.status === "error" ? escapeHtml(job.error || "Failed") : "-"}</td>`;

      const reportLink = job.reportId
        ? `<a href="/api/reports/${escapeHtml(job.reportId)}" class="report-link">View</a>`
        : "";

      return `<tr>
        <td class="url-cell">
          <div class="url-source">${escapeHtml(job.sourceUrl)}</div>
          <div class="url-target">${escapeHtml(job.targetUrl)}</div>
        </td>
        ${counts}
        <td class="status-cell"><span class="status-badge ${statusClass}">${escapeHtml(job.status)}</span></td>
        <td class="action-cell">${reportLink}</td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shadow QA — Batch Summary</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>${getSummaryCSS()}</style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" title="Toggle dark mode" aria-label="Toggle dark mode">
    <svg class="theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
    <svg class="theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  </button>

  <div class="container">
    <header>
      <a href="/" class="back-link">&larr; Back to Dashboard</a>
      <h1>Batch Summary Report</h1>
      <div class="batch-info">
        <span class="info-item">Batch ${escapeHtml(batch.id.slice(0, 8))}...</span>
        <span class="info-item">${escapeHtml(batch.createdAt)}</span>
        <span class="info-item">${batch.viewport.width} x ${batch.viewport.height}</span>
        <span class="info-item">${batch.totalJobs} pages scanned</span>
      </div>
    </header>

    <section class="summary-cards">
      <div class="card card-total">
        <div class="card-value">${totals.total}</div>
        <div class="card-label">Total Findings</div>
      </div>
      <div class="card card-critical">
        <div class="card-value">${totals.critical}</div>
        <div class="card-label">Critical</div>
      </div>
      <div class="card card-major">
        <div class="card-value">${totals.major}</div>
        <div class="card-label">Major</div>
      </div>
      <div class="card card-normal">
        <div class="card-value">${totals.normal}</div>
        <div class="card-label">Normal</div>
      </div>
      <div class="card card-minor">
        <div class="card-value">${totals.minor}</div>
        <div class="card-label">Minor</div>
      </div>
      <div class="card card-trivial">
        <div class="card-value">${totals.trivial}</div>
        <div class="card-label">Trivial</div>
      </div>
    </section>

    <section class="status-bar">
      <div class="status-segment status-complete" style="width: ${batch.totalJobs ? (batch.completedJobs / batch.totalJobs * 100) : 0}%">${batch.completedJobs} complete</div>
      <div class="status-segment status-failed" style="width: ${batch.totalJobs ? (batch.failedJobs / batch.totalJobs * 100) : 0}%">${batch.failedJobs ? batch.failedJobs + " failed" : ""}</div>
    </section>

    <section class="results-table">
      <h2>Per-Page Results</h2>
      <table>
        <thead>
          <tr>
            <th class="th-url">URL Pair</th>
            <th class="th-sev">Crit</th>
            <th class="th-sev">Major</th>
            <th class="th-sev">Normal</th>
            <th class="th-sev">Minor</th>
            <th class="th-sev">Trivial</th>
            <th class="th-sev">Total</th>
            <th class="th-status">Status</th>
            <th class="th-action">Report</th>
          </tr>
        </thead>
        <tbody>
          ${pageRows}
        </tbody>
      </table>
    </section>
  </div>

  <script>
  (function() {
    var toggle = document.getElementById("themeToggle");
    var saved = localStorage.getItem("shadowqa-theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
    toggle.addEventListener("click", function() {
      var isDark = document.documentElement.getAttribute("data-theme") === "dark";
      var next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("shadowqa-theme", next);
    });
  })();
  </script>
</body>
</html>`;
}

function getSummaryCSS(): string {
  return `
:root {
  --primary: #667eea;
  --bg: #f0f2f5;
  --card-bg: #ffffff;
  --text: #0f172a;
  --text-light: #64748b;
  --border: #e2e8f0;
  --glass-bg: rgba(255,255,255,0.55);
  --glass-border: rgba(255,255,255,0.5);
  --glass-shadow: 0 8px 32px rgba(0,0,0,0.06);
  --glass-blur: blur(20px);
  --radius: 12px;
  --radius-lg: 16px;
  --sev-critical: #dc2626;
  --sev-major: #ea580c;
  --sev-normal: #ca8a04;
  --sev-minor: #2563eb;
  --sev-trivial: #64748b;
  --success: #059669;
  --error: #dc2626;
}
[data-theme="dark"] {
  --bg: #0a0e1a;
  --card-bg: #141828;
  --text: #e2e8f0;
  --text-light: #94a3b8;
  --border: #1e293b;
  --glass-bg: rgba(20,24,40,0.7);
  --glass-border: rgba(148,163,184,0.08);
  --glass-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  min-height: 100vh;
}
.container { max-width: 1100px; margin: 0 auto; padding: 2rem; }
header { margin-bottom: 2rem; }
.back-link {
  display: inline-block;
  color: var(--primary);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}
.back-link:hover { text-decoration: underline; }
h1 {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 0.5rem;
}
.batch-info { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.82rem; color: var(--text-light); }
.info-item {
  padding: 0.2rem 0.6rem;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
}

/* Summary cards */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  padding: 1rem;
  text-align: center;
  box-shadow: var(--glass-shadow);
}
.card-value { font-size: 1.75rem; font-weight: 800; }
.card-label { font-size: 0.72rem; font-weight: 600; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 0.2rem; }
.card-total .card-value { color: var(--primary); }
.card-critical .card-value { color: var(--sev-critical); }
.card-major .card-value { color: var(--sev-major); }
.card-normal .card-value { color: var(--sev-normal); }
.card-minor .card-value { color: var(--sev-minor); }
.card-trivial .card-value { color: var(--sev-trivial); }

/* Status bar */
.status-bar {
  display: flex;
  height: 28px;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 2rem;
  background: var(--border);
  font-size: 0.72rem;
  font-weight: 600;
}
.status-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  transition: width 0.5s;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.status-segment.status-complete { background: var(--success); }
.status-segment.status-failed { background: var(--error); }

/* Results table */
.results-table { margin-bottom: 2rem; }
.results-table h2 {
  font-size: 1.15rem;
  font-weight: 700;
  margin-bottom: 1rem;
  letter-spacing: -0.02em;
}
table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
thead {
  background: var(--glass-bg);
  position: sticky;
  top: 0;
}
th {
  padding: 0.6rem 0.5rem;
  text-align: left;
  font-weight: 600;
  font-size: 0.72rem;
  color: var(--text-light);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 2px solid var(--border);
}
.th-sev { text-align: center; width: 55px; }
.th-status { text-align: center; width: 80px; }
.th-action { text-align: center; width: 60px; }
td {
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
tbody tr:hover { background: var(--glass-bg); }
.url-cell { max-width: 400px; }
.url-source {
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}
.url-target {
  font-size: 0.75rem;
  color: var(--text-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}
.count { text-align: center; font-weight: 600; }
.count-critical { color: var(--sev-critical); }
.count-major { color: var(--sev-major); }
.count-normal { color: var(--sev-normal); }
.count-minor { color: var(--sev-minor); }
.count-trivial { color: var(--sev-trivial); }
.count-total { color: var(--text); font-weight: 700; }
.no-data { text-align: center; color: var(--text-light); font-style: italic; }
.status-cell { text-align: center; }
.status-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
}
.status-complete { background: rgba(5,150,105,0.1); color: var(--success); }
.status-error { background: rgba(220,38,38,0.1); color: var(--error); }
.status-pending { background: rgba(100,116,139,0.1); color: var(--text-light); }
.action-cell { text-align: center; }
.report-link {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.78rem;
}
.report-link:hover { text-decoration: underline; }

/* Theme toggle */
.theme-toggle {
  position: fixed; top: 1.25rem; right: 1.5rem;
  background: var(--glass-bg); backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border); border-radius: 10px;
  padding: 0.5rem; cursor: pointer; color: var(--text);
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--glass-shadow); z-index: 100;
}
.theme-icon-light { display: inline-block; }
.theme-icon-dark { display: none; }
[data-theme="dark"] .theme-icon-light { display: none !important; }
[data-theme="dark"] .theme-icon-dark { display: inline-block !important; }

@media (max-width: 768px) {
  .summary-cards { grid-template-columns: repeat(3, 1fr); }
  .container { padding: 1rem; }
  h1 { font-size: 1.5rem; }
  table { font-size: 0.75rem; }
}
  `;
}
