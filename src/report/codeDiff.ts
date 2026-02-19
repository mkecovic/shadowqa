import * as Diff from "diff";

interface DiffLine {
  num: number | null;
  html: string;      // pre-escaped HTML (may contain <span> highlights)
  type: "added" | "removed" | "unchanged" | "placeholder";
}

/**
 * For minified files (very few lines relative to content size),
 * insert newlines at logical break points so diffLines can work properly.
 */
function unminify(code: string): string {
  const lines = code.split("\n");
  const avgLen = code.length / Math.max(lines.length, 1);
  // Only unminify if average line length is very long (> 500 chars)
  if (avgLen <= 500) return code;

  return code
    // Break after ;} and ;  but not inside strings (best-effort)
    .replace(/;(\s*})/g, ";\n$1")
    .replace(/(;\s*)(?=[a-zA-Z_$\/])/g, "$1\n")
    .replace(/(\{)\s*(?=[a-zA-Z_$\/])/g, "$1\n")
    .replace(/(})\s*(?=[a-zA-Z_$\/])/g, "$1\n");
}

/**
 * Compute inline word-level diff between two strings.
 * Returns HTML with <span class="hl-del"> / <span class="hl-add"> wrappers.
 */
function inlineDiff(
  oldText: string,
  newText: string
): { leftHtml: string; rightHtml: string } {
  const wordChanges = Diff.diffWordsWithSpace(oldText, newText);

  let leftParts: string[] = [];
  let rightParts: string[] = [];

  for (const part of wordChanges) {
    const escaped = escapeHtml(part.value);
    if (part.added) {
      rightParts.push(`<span class="hl-add">${escaped}</span>`);
    } else if (part.removed) {
      leftParts.push(`<span class="hl-del">${escaped}</span>`);
    } else {
      leftParts.push(escaped);
      rightParts.push(escaped);
    }
  }

  return { leftHtml: leftParts.join(""), rightHtml: rightParts.join("") };
}

export function buildCodeDiffReport(
  reportId: string,
  sourceCode: string,
  targetCode: string,
  language: string,
  sourceLabel: string,
  targetLabel: string
): string {
  // Normalize line endings
  let normSource = sourceCode.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let normTarget = targetCode.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Unminify if needed so diffLines has meaningful lines to compare
  normSource = unminify(normSource);
  normTarget = unminify(normTarget);

  const changes = Diff.diffLines(normSource, normTarget);

  // First pass: collect consecutive removed/added blocks so we can pair them
  const leftLines: DiffLine[] = [];
  const rightLines: DiffLine[] = [];

  let leftNum = 0;
  let rightNum = 0;

  // Group changes into paired blocks: a removed block followed by an added block
  // gets inline word-diff highlighting
  let i = 0;
  while (i < changes.length) {
    const change = changes[i];
    if (change.value === "") { i++; continue; }

    if (!change.added && !change.removed) {
      // Unchanged
      const lines = stripTrailingNewline(change.value).split("\n");
      for (const line of lines) {
        leftNum++;
        rightNum++;
        leftLines.push({ num: leftNum, html: escapeHtml(line), type: "unchanged" });
        rightLines.push({ num: rightNum, html: escapeHtml(line), type: "unchanged" });
      }
      i++;
    } else if (change.removed && i + 1 < changes.length && changes[i + 1].added) {
      // Paired removed+added: do inline diff
      const removedText = stripTrailingNewline(change.value);
      const addedText = stripTrailingNewline(changes[i + 1].value);
      const removedLines = removedText.split("\n");
      const addedLines = addedText.split("\n");

      // Line-pair the two blocks with inline highlighting
      const maxLen = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < maxLen; j++) {
        const oldLine = j < removedLines.length ? removedLines[j] : null;
        const newLine = j < addedLines.length ? addedLines[j] : null;

        if (oldLine !== null && newLine !== null) {
          // Both exist: inline word diff
          const { leftHtml, rightHtml } = inlineDiff(oldLine, newLine);
          leftNum++;
          rightNum++;
          leftLines.push({ num: leftNum, html: leftHtml, type: "removed" });
          rightLines.push({ num: rightNum, html: rightHtml, type: "added" });
        } else if (oldLine !== null) {
          leftNum++;
          leftLines.push({ num: leftNum, html: escapeHtml(oldLine), type: "removed" });
          rightLines.push({ num: null, html: "", type: "placeholder" });
        } else if (newLine !== null) {
          rightNum++;
          leftLines.push({ num: null, html: "", type: "placeholder" });
          rightLines.push({ num: rightNum, html: escapeHtml(newLine), type: "added" });
        }
      }
      i += 2;
    } else if (change.removed) {
      const lines = stripTrailingNewline(change.value).split("\n");
      for (const line of lines) {
        leftNum++;
        leftLines.push({ num: leftNum, html: escapeHtml(line), type: "removed" });
        rightLines.push({ num: null, html: "", type: "placeholder" });
      }
      i++;
    } else if (change.added) {
      const lines = stripTrailingNewline(change.value).split("\n");
      for (const line of lines) {
        rightNum++;
        leftLines.push({ num: null, html: "", type: "placeholder" });
        rightLines.push({ num: rightNum, html: escapeHtml(line), type: "added" });
      }
      i++;
    } else {
      i++;
    }
  }

  // Stats
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const change of changes) {
    if (change.value === "") continue;
    const count = stripTrailingNewline(change.value).split("\n").length;
    if (change.added) added += count;
    else if (change.removed) removed += count;
    else unchanged += count;
  }
  const total = added + removed + unchanged;

  // Build HTML rows
  const rows = leftLines
    .map((left, idx) => {
      const right = rightLines[idx];
      const leftClass = left.type === "removed" ? "diff-removed" : left.type === "placeholder" ? "diff-placeholder" : "";
      const rightClass = right.type === "added" ? "diff-added" : right.type === "placeholder" ? "diff-placeholder" : "";
      return `<tr>
        <td class="line-num ${leftClass}">${left.num !== null ? left.num : ""}</td>
        <td class="line-code ${leftClass}">${left.html}</td>
        <td class="line-num ${rightClass}">${right.num !== null ? right.num : ""}</td>
        <td class="line-code ${rightClass}">${right.html}</td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shadow QA — Code Diff — ${escapeHtml(sourceLabel)} vs ${escapeHtml(targetLabel)}</title>
  <style>${getCodeDiffCSS()}</style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle" title="Toggle dark mode" aria-label="Toggle dark mode">
    <svg class="theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
    <svg class="theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  </button>

  <header class="report-header">
    <div class="header-top">
      <a href="/" class="back-link">&larr; Back</a>
    </div>
    <div class="header-row">
      <h1>Shadow QA — Code Diff</h1>
    </div>
    <p class="report-meta">
      <strong>Language:</strong> ${escapeHtml(language)}<br>
      <strong>Source:</strong> ${escapeHtml(sourceLabel)}<br>
      <strong>Target:</strong> ${escapeHtml(targetLabel)}
    </p>
  </header>

  <section class="stats">
    <div class="stat-card stat-added">
      <span class="stat-count">+${added}</span>
      <span class="stat-label">Added</span>
    </div>
    <div class="stat-card stat-removed">
      <span class="stat-count">-${removed}</span>
      <span class="stat-label">Removed</span>
    </div>
    <div class="stat-card stat-unchanged">
      <span class="stat-count">${unchanged}</span>
      <span class="stat-label">Unchanged</span>
    </div>
    <div class="stat-card stat-total">
      <span class="stat-count">${total}</span>
      <span class="stat-label">Total Lines</span>
    </div>
  </section>

  <section class="diff-container">
    <div class="diff-header">
      <span class="diff-header-label">${escapeHtml(sourceLabel)}</span>
      <span class="diff-header-label">${escapeHtml(targetLabel)}</span>
    </div>
    <div class="diff-scroll" id="diffScroll">
      <table class="diff-table">
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </section>

  <footer class="report-footer">
    <p>Generated by Shadow QA — Code Diff</p>
  </footer>

  <script>${getCodeDiffJS()}</script>
</body>
</html>`;
}

function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCodeDiffJS(): string {
  return `
    (function() {
      // Dark mode
      var themeToggle = document.getElementById('themeToggle');
      var savedTheme = localStorage.getItem('shadowqa-theme');
      if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
      if (themeToggle) {
        themeToggle.addEventListener('click', function() {
          var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
          if (isDark) {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('shadowqa-theme', 'light');
          } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('shadowqa-theme', 'dark');
          }
        });
      }
    })();
  `;
}

function getCodeDiffCSS(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-light: #64748b;
      --border: #e2e8f0;
      --radius: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --code-bg: #f1f5f9;

      --glass-bg: rgba(255, 255, 255, 0.6);
      --glass-border: rgba(255, 255, 255, 0.3);
      --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
      --glass-blur: blur(16px);
      --gradient-1: #667eea;
      --gradient-2: #764ba2;
      --gradient-3: #f093fb;
      --gradient-4: #2563eb;

      --diff-added-bg: #f0fdf4;
      --diff-added-num: #dcfce7;
      --diff-removed-bg: #fef2f2;
      --diff-removed-num: #fee2e2;
      --diff-placeholder-bg: #f1f5f9;
      --total: #2563eb;

      --hl-add-bg: #86efac;
      --hl-del-bg: #fca5a5;
    }

    [data-theme="dark"] {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #e2e8f0;
      --text-light: #94a3b8;
      --border: #334155;
      --code-bg: #334155;

      --glass-bg: rgba(30, 41, 59, 0.6);
      --glass-border: rgba(148, 163, 184, 0.1);
      --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);

      --diff-added-bg: rgba(22, 101, 52, 0.15);
      --diff-added-num: rgba(22, 101, 52, 0.25);
      --diff-removed-bg: rgba(127, 29, 29, 0.15);
      --diff-removed-num: rgba(127, 29, 29, 0.25);
      --diff-placeholder-bg: #1e293b;

      --hl-add-bg: #166534;
      --hl-del-bg: #991b1b;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]):not([data-theme]) {
        --bg: #0f172a;
        --card-bg: #1e293b;
        --text: #e2e8f0;
        --text-light: #94a3b8;
        --border: #334155;
        --code-bg: #334155;
        --glass-bg: rgba(30, 41, 59, 0.6);
        --glass-border: rgba(148, 163, 184, 0.1);
        --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        --diff-added-bg: #14532d;
        --diff-added-num: #166534;
        --diff-removed-bg: #450a0a;
        --diff-removed-num: #7f1d1d;
        --diff-placeholder-bg: #1e293b;
        --hl-add-bg: #166534;
        --hl-del-bg: #991b1b;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
      max-width: 1400px;
      margin: 0 auto;
      position: relative;
    }

    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: linear-gradient(135deg, var(--gradient-1), var(--gradient-2), var(--gradient-3), var(--gradient-4));
      background-size: 400% 400%;
      animation: gradientShift 15s ease infinite;
      opacity: 0.08;
      z-index: -2;
      pointer-events: none;
    }

    @keyframes gradientShift {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .report-header {
      margin-bottom: 1.5rem;
      padding: 1.5rem;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      box-shadow: var(--glass-shadow);
      animation: fadeInUp 0.6s ease both;
    }

    .header-top { margin-bottom: 0.75rem; }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-light);
      text-decoration: none;
      transition: color 0.15s;
    }
    .back-link:hover { color: var(--text); }

    .header-row { margin-bottom: 0.5rem; }

    .report-header h1 {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    .report-meta {
      color: var(--text-light);
      font-size: 0.9rem;
    }

    .theme-toggle {
      position: fixed;
      top: 1.25rem;
      right: 1.5rem;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      padding: 0.5rem;
      cursor: pointer;
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--glass-shadow);
      transition: transform 0.25s, box-shadow 0.25s, border-color 0.2s;
      z-index: 100;
    }
    .theme-toggle:hover {
      border-color: var(--text-light);
      transform: translateY(-2px);
    }
    .theme-icon-light { display: inline-block; }
    .theme-icon-dark { display: none; }
    [data-theme="dark"] .theme-icon-light { display: none !important; }
    [data-theme="dark"] .theme-icon-dark { display: inline-block !important; }
    [data-theme="light"] .theme-icon-light { display: inline-block !important; }
    [data-theme="light"] .theme-icon-dark { display: none !important; }

    .stats {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
      animation: fadeInUp 0.5s ease 0.1s both;
    }

    .stat-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--glass-shadow);
      padding: 1rem 1.5rem;
      min-width: 100px;
    }

    .stat-count { font-size: 2rem; font-weight: 700; }
    .stat-label { font-size: 0.85rem; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.05em; }

    .stat-added .stat-count { color: #16a34a; }
    .stat-removed .stat-count { color: #dc2626; }
    .stat-unchanged .stat-count { color: var(--text-light); }
    .stat-total .stat-count { color: var(--total); }

    .diff-container {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--glass-shadow);
      overflow: hidden;
      animation: fadeInUp 0.5s ease 0.2s both;
    }

    .diff-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-bottom: 1px solid var(--border);
    }

    .diff-header-label {
      padding: 0.6rem 1rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-light);
      text-overflow: ellipsis;
      overflow: hidden;
      white-space: nowrap;
    }

    .diff-header-label:first-child {
      border-right: 1px solid var(--border);
    }

    .diff-scroll {
      overflow: auto;
      max-height: 80vh;
    }

    .diff-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
      font-size: 0.8rem;
      line-height: 1.5;
      table-layout: fixed;
    }

    .diff-table td {
      vertical-align: top;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .line-num {
      width: 50px;
      min-width: 50px;
      padding: 0 0.6rem;
      text-align: right;
      color: var(--text-light);
      user-select: none;
      border-right: 1px solid var(--border);
      background: var(--code-bg);
      font-size: 0.72rem;
    }

    .line-code {
      padding: 0 0.75rem;
    }

    /* Left side border */
    .diff-table td:nth-child(2) {
      border-right: 2px solid var(--border);
    }

    .diff-added { background: var(--diff-added-bg); }
    .line-num.diff-added { background: var(--diff-added-num); }
    .diff-removed { background: var(--diff-removed-bg); }
    .line-num.diff-removed { background: var(--diff-removed-num); }
    .diff-placeholder { background: var(--diff-placeholder-bg); }
    .line-num.diff-placeholder { background: var(--diff-placeholder-bg); }

    .hl-add {
      background: var(--hl-add-bg);
      border-radius: 2px;
      padding: 0 1px;
    }

    .hl-del {
      background: var(--hl-del-bg);
      border-radius: 2px;
      padding: 0 1px;
    }

    .report-footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-light);
      font-size: 0.85rem;
    }

    @supports not (backdrop-filter: blur(16px)) {
      .report-header, .stat-card, .diff-container, .theme-toggle {
        background: var(--card-bg);
      }
    }

    @media (max-width: 768px) {
      body { padding: 1rem; }
      .stats { flex-direction: row; overflow-x: auto; flex-wrap: nowrap; }
      .stat-card { min-width: 80px; padding: 0.75rem 1rem; }
      .stat-count { font-size: 1.5rem; }
      .line-num { width: 35px; min-width: 35px; font-size: 0.65rem; padding: 0 0.3rem; }
      .line-code { padding: 0 0.4rem; }
    }
  `;
}
