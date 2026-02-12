import type { ComparisonReport, Finding } from "../types/index.js";

export function buildHtmlReport(report: ComparisonReport): string {
  const severityOrder = ["critical", "major", "minor", "warning", "cosmetic"] as const;
  const groupedFindings = new Map<string, Finding[]>();
  for (const sev of severityOrder) {
    groupedFindings.set(
      sev,
      report.findings.filter((f) => f.severity === sev)
    );
  }

  const categories = ["untranslated", "layout", "missing", "accessibility", "functionality"] as const;
  const categoryCounts = new Map<string, number>();
  for (const cat of categories) {
    categoryCounts.set(cat, report.findings.filter((f) => f.category === cat).length);
  }

  const localeParts: string[] = [];
  if (report.sourceLocale) localeParts.push(escapeHtml(report.sourceLocale));
  if (report.targetLocale) localeParts.push(escapeHtml(report.targetLocale));
  const localeDisplay = localeParts.length > 0
    ? ` <span class="locale-badge">${localeParts.join(" → ")}</span>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shadow QA — Localization Report — ${escapeHtml(report.sourceUrl)} vs ${escapeHtml(report.targetUrl)}</title>
  <style>${getReportCSS()}</style>
</head>
<body>
  <header class="report-header">
    <div class="header-row">
      <h1>Shadow QA — Localization Report${localeDisplay}</h1>
      <button class="theme-toggle" id="themeToggle" title="Toggle dark mode" aria-label="Toggle dark mode">
        <svg class="theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        <svg class="theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
    </div>
    <p class="report-meta">
      Generated ${escapeHtml(report.timestamp)}<br>
      <strong>Source:</strong> ${escapeHtml(report.sourceUrl)}${report.sourceLocale ? ` <span class="locale-inline">(${escapeHtml(report.sourceLocale)})</span>` : ""}<br>
      <strong>Target:</strong> ${escapeHtml(report.targetUrl)}${report.targetLocale ? ` <span class="locale-inline">(${escapeHtml(report.targetLocale)})</span>` : ""}<br>
      <strong>Viewport:</strong> ${report.viewport.width} x ${report.viewport.height}
    </p>
  </header>

  <section class="summary">
    <h2>Summary</h2>
    <div class="summary-cards">
      ${severityOrder.map((sev) => {
        const count = (groupedFindings.get(sev) || []).length;
        return summaryCard(capitalize(sev), count, sev, count > 0);
      }).join("\n      ")}
      ${summaryCard("Total", report.summary.total, "total", false)}
    </div>
  </section>

  <section class="filters" id="filters">
    <div class="filters-row">
      <div class="filter-group">
        <span class="filter-label">Category</span>
        <div class="filter-buttons">
          ${categories.map((cat) => {
            const count = categoryCounts.get(cat) || 0;
            return `<button class="filter-btn active" data-filter="${cat}" ${count === 0 ? "disabled" : ""}>
            <span class="filter-dot filter-dot-${cat}"></span>
            ${capitalize(cat)} <span class="filter-count">${count}</span>
          </button>`;
          }).join("\n          ")}
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Severity</span>
        <div class="filter-buttons">
          ${severityOrder.map((sev) => {
            const count = (groupedFindings.get(sev) || []).length;
            return `<button class="filter-btn sev-filter active" data-severity="${sev}" ${count === 0 ? "disabled" : ""}>
            <span class="sev-dot sev-dot-${sev}"></span>
            ${capitalize(sev)} <span class="filter-count">${count}</span>
          </button>`;
          }).join("\n          ")}
        </div>
      </div>
    </div>
    <div class="controls-row">
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search findings..." aria-label="Search findings">
        <span class="search-count" id="searchCount"></span>
      </div>
      <div class="global-controls">
        <button class="ctrl-btn" id="expandAll">Expand all</button>
        <button class="ctrl-btn" id="collapseAll">Collapse all</button>
        <button class="ctrl-btn" id="resetFilters">Reset filters</button>
      </div>
    </div>
  </section>

  <section class="screenshots">
    <div class="screenshot-tabs" role="tablist" aria-label="Screenshot views">
      <button class="screenshot-tab active" data-tab="source" role="tab" aria-selected="true" aria-controls="pane-source" id="tab-source" tabindex="0">Source</button>
      <button class="screenshot-tab" data-tab="target" role="tab" aria-selected="false" aria-controls="pane-target" id="tab-target" tabindex="-1">Target</button>
      <button class="screenshot-tab" data-tab="diff" role="tab" aria-selected="false" aria-controls="pane-diff" id="tab-diff" tabindex="-1">Diff</button>
      <button class="screenshot-tab" data-tab="sidebyside" role="tab" aria-selected="false" aria-controls="pane-sidebyside" id="tab-sidebyside" tabindex="-1">Side by Side</button>
      <button class="download-btn" id="screenshotDownload" data-filename="source.png" data-src="data:image/png;base64,${report.sourceScreenshot}">Download</button>
    </div>
    <div class="screenshot-pane active" data-pane="source" role="tabpanel" id="pane-source" aria-labelledby="tab-source">
      <img src="data:image/png;base64,${report.sourceScreenshot}" alt="Source page screenshot">
    </div>
    <div class="screenshot-pane" data-pane="target" role="tabpanel" id="pane-target" aria-labelledby="tab-target">
      <img src="data:image/png;base64,${report.targetScreenshot}" alt="Target page screenshot">
    </div>
    <div class="screenshot-pane" data-pane="diff" role="tabpanel" id="pane-diff" aria-labelledby="tab-diff">
      <img src="data:image/png;base64,${report.diffScreenshot}" alt="Visual diff">
    </div>
    <div class="screenshot-pane screenshot-sidebyside" data-pane="sidebyside" role="tabpanel" id="pane-sidebyside" aria-labelledby="tab-sidebyside">
      <div class="sbs-panel" id="sbsLeft">
        <div class="sbs-label">Source</div>
        <img src="data:image/png;base64,${report.sourceScreenshot}" alt="Source page screenshot">
      </div>
      <div class="sbs-panel" id="sbsRight">
        <div class="sbs-label">Target</div>
        <img src="data:image/png;base64,${report.targetScreenshot}" alt="Target page screenshot">
      </div>
    </div>
  </section>


  ${severityOrder
    .map((sev) => {
      const findings = groupedFindings.get(sev) || [];
      if (findings.length === 0) return "";
      return `
  <section class="findings-section" id="section-${sev}">
    <h2 class="severity-heading severity-${sev}">${capitalize(sev)} Findings (<span class="section-visible-count" data-severity="${sev}">${findings.length}</span>)</h2>
    ${findings.map((f) => findingCard(f)).join("\n")}
  </section>`;
    })
    .join("\n")}

  ${report.findings.length === 0 ? '<section class="no-findings"><h2>No localization issues detected</h2><p>The localized page appears consistent with the source page. No untranslated text, layout issues, missing elements, or accessibility regressions were found.</p></section>' : ""}

  <footer class="report-footer">
    <p>Generated by Shadow QA — Localization QA</p>
  </footer>

  <script>${getReportJS()}</script>
</body>
</html>`;
}

function summaryCard(label: string, count: number, cls: string, clickable: boolean): string {
  if (clickable && count > 0) {
    return `<a href="#section-${cls}" class="summary-card ${cls} clickable">
    <span class="count">${count}</span>
    <span class="label">${label}</span>
  </a>`;
  }
  return `<div class="summary-card ${cls}">
    <span class="count">${count}</span>
    <span class="label">${label}</span>
  </div>`;
}

function findingCard(f: Finding): string {
  const autoExpand = f.severity === "critical" || f.severity === "major";
  return `<div class="finding-card severity-${f.severity}${autoExpand ? " expanded" : ""}" data-category="${f.category}" data-severity="${f.severity}">
    <div class="finding-summary" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="finding-header">
        <span class="badge badge-${f.severity}">${f.severity.toUpperCase()}</span>
        <span class="badge badge-${f.category}">${f.category}</span>
        <span class="confidence" title="Confidence: how likely this is a real issue">${(f.confidence * 100).toFixed(0)}% confidence</span>
        <span class="expand-icon"></span>
      </div>
      <h3 class="finding-title">${escapeHtml(f.title)}</h3>
    </div>
    <div class="finding-body">
      <p class="finding-description">${escapeHtml(f.description)}</p>

      <div class="finding-detail">
        <strong>Impact:</strong>
        <p>${escapeHtml(f.impact)}</p>
      </div>

      <div class="finding-detail finding-selector">
        <strong>Element:</strong>
        <code class="selector-text">${escapeHtml(f.element.selector)}</code> (<code>${escapeHtml(f.element.tag)}</code>)
        <button class="copy-btn" data-copy="${escapeHtml(f.element.selector)}" title="Copy selector">Copy</button>
      </div>

      <div class="finding-diff" data-diff-source="${escapeAttr(f.source)}" data-diff-target="${escapeAttr(f.target)}">
        <div class="diff-source">
          <strong>Source:</strong>
          <pre>${escapeHtml(f.source)}</pre>
        </div>
        <div class="diff-target">
          <strong>Target:</strong>
          <pre>${escapeHtml(f.target)}</pre>
        </div>
      </div>

      <div class="finding-recommendation">
        <strong>Recommendation:</strong>
        <p>${escapeHtml(f.recommendation)}</p>
      </div>
    </div>
  </div>`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/\n/g, "&#10;");
}

function getReportJS(): string {
  return `
    (function() {
      // --- Category filter buttons ---
      var catButtons = document.querySelectorAll('.filter-btn[data-filter]');
      var sevButtons = document.querySelectorAll('.filter-btn[data-severity]');
      var resetBtn = document.getElementById('resetFilters');
      var cards = document.querySelectorAll('.finding-card[data-category]');
      var searchInput = document.getElementById('searchInput');
      var searchCount = document.getElementById('searchCount');
      var expandAllBtn = document.getElementById('expandAll');
      var collapseAllBtn = document.getElementById('collapseAll');

      function getActiveCategories() {
        var active = [];
        for (var i = 0; i < catButtons.length; i++) {
          if (catButtons[i].classList.contains('active')) {
            active.push(catButtons[i].getAttribute('data-filter'));
          }
        }
        return active;
      }

      function getActiveSeverities() {
        var active = [];
        for (var i = 0; i < sevButtons.length; i++) {
          if (sevButtons[i].classList.contains('active')) {
            active.push(sevButtons[i].getAttribute('data-severity'));
          }
        }
        return active;
      }

      function applyFilters() {
        var activeCats = getActiveCategories();
        var activeSevs = getActiveSeverities();
        var searchTerm = (searchInput.value || '').toLowerCase().trim();
        var allCats = activeCats.length === 0 || activeCats.length === catButtons.length;
        var allSevs = activeSevs.length === 0 || activeSevs.length === sevButtons.length;
        var visibleTotal = 0;

        for (var i = 0; i < cards.length; i++) {
          var cat = cards[i].getAttribute('data-category');
          var sev = cards[i].getAttribute('data-severity');
          var catMatch = allCats || activeCats.indexOf(cat) !== -1;
          var sevMatch = allSevs || activeSevs.indexOf(sev) !== -1;
          var searchMatch = !searchTerm || cards[i].textContent.toLowerCase().indexOf(searchTerm) !== -1;
          if (catMatch && sevMatch && searchMatch) {
            cards[i].style.display = '';
            visibleTotal++;
          } else {
            cards[i].style.display = 'none';
          }
        }

        // Update section visibility and counts
        var sections = document.querySelectorAll('.findings-section');
        for (var j = 0; j < sections.length; j++) {
          var sectionCards = sections[j].querySelectorAll('.finding-card[data-category]');
          var visibleCount = 0;
          for (var k = 0; k < sectionCards.length; k++) {
            if (sectionCards[k].style.display !== 'none') visibleCount++;
          }
          var countEl = sections[j].querySelector('.section-visible-count');
          if (countEl) countEl.textContent = visibleCount;
          sections[j].style.display = visibleCount === 0 ? 'none' : '';
        }

        // Update search count
        if (searchTerm) {
          searchCount.textContent = visibleTotal + ' of ' + cards.length + ' findings';
        } else {
          searchCount.textContent = '';
        }
      }

      for (var i = 0; i < catButtons.length; i++) {
        catButtons[i].addEventListener('click', function() {
          this.classList.toggle('active');
          applyFilters();
        });
      }

      for (var i = 0; i < sevButtons.length; i++) {
        sevButtons[i].addEventListener('click', function() {
          this.classList.toggle('active');
          applyFilters();
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', function() {
          for (var i = 0; i < catButtons.length; i++) catButtons[i].classList.add('active');
          for (var i = 0; i < sevButtons.length; i++) sevButtons[i].classList.add('active');
          searchInput.value = '';
          applyFilters();
        });
      }

      // Search
      if (searchInput) {
        searchInput.addEventListener('input', function() { applyFilters(); });
      }

      // Expand/Collapse all
      if (expandAllBtn) {
        expandAllBtn.addEventListener('click', function() {
          for (var i = 0; i < cards.length; i++) cards[i].classList.add('expanded');
        });
      }
      if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', function() {
          for (var i = 0; i < cards.length; i++) cards[i].classList.remove('expanded');
        });
      }

      // Summary card smooth scroll
      var summaryLinks = document.querySelectorAll('.summary-card.clickable');
      for (var i = 0; i < summaryLinks.length; i++) {
        summaryLinks[i].addEventListener('click', function(e) {
          e.preventDefault();
          var targetId = this.getAttribute('href').slice(1);
          var target = document.getElementById(targetId);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }

      // --- Screenshot tabs with keyboard navigation ---
      var tabs = document.querySelectorAll('.screenshot-tab');
      var panes = document.querySelectorAll('.screenshot-pane');
      var dlBtn = document.getElementById('screenshotDownload');

      var screenshotData = {
        source: { filename: 'source.png', src: document.querySelector('[data-pane="source"] img').src },
        target: { filename: 'target.png', src: document.querySelector('[data-pane="target"] img').src },
        diff: { filename: 'diff.png', src: document.querySelector('[data-pane="diff"] img').src }
      };

      var switchTab = function(tabName) {
        for (var j = 0; j < tabs.length; j++) {
          var isActive = tabs[j].getAttribute('data-tab') === tabName;
          tabs[j].classList.toggle('active', isActive);
          tabs[j].setAttribute('aria-selected', isActive ? 'true' : 'false');
          tabs[j].setAttribute('tabindex', isActive ? '0' : '-1');
        }
        for (var j = 0; j < panes.length; j++) {
          panes[j].classList.toggle('active', panes[j].getAttribute('data-pane') === tabName);
        }
        if (dlBtn && screenshotData[tabName]) {
          dlBtn.setAttribute('data-filename', screenshotData[tabName].filename);
          dlBtn.setAttribute('data-src', screenshotData[tabName].src);
        }
      };

      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function() {
          switchTab(this.getAttribute('data-tab'));
          this.focus();
        });
        tabs[i].addEventListener('keydown', function(e) {
          var tabOrder = [];
          for (var j = 0; j < tabs.length; j++) tabOrder.push(tabs[j]);
          var idx = tabOrder.indexOf(this);
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            var next = (idx + 1) % tabOrder.length;
            switchTab(tabOrder[next].getAttribute('data-tab'));
            tabOrder[next].focus();
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = (idx - 1 + tabOrder.length) % tabOrder.length;
            switchTab(tabOrder[prev].getAttribute('data-tab'));
            tabOrder[prev].focus();
          }
        });
      }

      if (dlBtn) {
        dlBtn.addEventListener('click', function() {
          var src = this.getAttribute('data-src');
          var filename = this.getAttribute('data-filename');
          var a = document.createElement('a');
          a.href = src;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        });
      }

      // --- Side-by-side synchronized scrolling ---
      var sbsLeft = document.getElementById('sbsLeft');
      var sbsRight = document.getElementById('sbsRight');
      if (sbsLeft && sbsRight) {
        var syncing = false;
        sbsLeft.addEventListener('scroll', function() {
          if (syncing) return;
          syncing = true;
          sbsRight.scrollTop = sbsLeft.scrollTop;
          sbsRight.scrollLeft = sbsLeft.scrollLeft;
          syncing = false;
        });
        sbsRight.addEventListener('scroll', function() {
          if (syncing) return;
          syncing = true;
          sbsLeft.scrollTop = sbsRight.scrollTop;
          sbsLeft.scrollLeft = sbsRight.scrollLeft;
          syncing = false;
        });
      }

      // --- Copy selector button ---
      document.addEventListener('click', function(e) {
        if (e.target && e.target.classList && e.target.classList.contains('copy-btn')) {
          var text = e.target.getAttribute('data-copy')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#039;/g, "'");
          navigator.clipboard.writeText(text).then(function() {
            var btn = e.target;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
          });
        }
      });

      // --- Inline word-diff highlighting ---
      var wordDiff = function(a, b) {
        var wordsA = a.split(/([\\s,.;:!?()\\[\\]{}"']+)/);
        var wordsB = b.split(/([\\s,.;:!?()\\[\\]{}"']+)/);
        // Simple LCS-based diff
        var m = wordsA.length, n = wordsB.length;
        // For performance, cap at 500 tokens
        if (m > 500 || n > 500) return { sourceHtml: esc(a), targetHtml: esc(b) };
        var dp = [];
        for (var i = 0; i <= m; i++) { dp[i] = []; for (var j = 0; j <= n; j++) dp[i][j] = 0; }
        for (var i = 1; i <= m; i++) {
          for (var j = 1; j <= n; j++) {
            if (wordsA[i-1] === wordsB[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
            else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
          }
        }
        var srcParts = [], tgtParts = [];
        var i = m, j = n;
        while (i > 0 || j > 0) {
          if (i > 0 && j > 0 && wordsA[i-1] === wordsB[j-1]) {
            srcParts.unshift(esc(wordsA[i-1]));
            tgtParts.unshift(esc(wordsB[j-1]));
            i--; j--;
          } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
            tgtParts.unshift('<span class="diff-add">' + esc(wordsB[j-1]) + '</span>');
            j--;
          } else {
            srcParts.unshift('<span class="diff-del">' + esc(wordsA[i-1]) + '</span>');
            i--;
          }
        }
        return { sourceHtml: srcParts.join(''), targetHtml: tgtParts.join('') };
      };

      var esc = function(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
      };

      var diffContainers = document.querySelectorAll('.finding-diff');
      for (var i = 0; i < diffContainers.length; i++) {
        var container = diffContainers[i];
        var srcText = (container.getAttribute('data-diff-source') || '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#10;/g, '\\n');
        var tgtText = (container.getAttribute('data-diff-target') || '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#10;/g, '\\n');
        if (srcText && tgtText && srcText !== tgtText) {
          var result = wordDiff(srcText, tgtText);
          var srcPre = container.querySelector('.diff-source pre');
          var tgtPre = container.querySelector('.diff-target pre');
          if (srcPre) srcPre.innerHTML = result.sourceHtml;
          if (tgtPre) tgtPre.innerHTML = result.targetHtml;
        }
      }

      // --- Dark mode ---
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

function getReportCSS(): string {
  return `
    :root {
      --critical: #dc2626;
      --major: #ea580c;
      --minor: #ca8a04;
      --warning: #a16207;
      --cosmetic: #6b7280;
      --total: #2563eb;
      --cat-untranslated: #e11d48;
      --cat-layout: #7c3aed;
      --cat-missing: #ea580c;
      --cat-accessibility: #059669;
      --cat-functionality: #0891b2;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-light: #64748b;
      --border: #e2e8f0;
      --radius: 8px;
      --code-bg: #f1f5f9;
      --recommendation-bg: #f0fdf4;
      --recommendation-border: #bbf7d0;
      --hover-bg: #f8fafc;
      --diff-source-border: #3b82f6;
      --diff-target-border: #f59e0b;
    }

    [data-theme="dark"] {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #e2e8f0;
      --text-light: #94a3b8;
      --border: #334155;
      --code-bg: #334155;
      --recommendation-bg: #14532d;
      --recommendation-border: #166534;
      --hover-bg: #1e293b;
      --diff-source-border: #60a5fa;
      --diff-target-border: #fbbf24;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]):not([data-theme]) {
        --bg: #0f172a;
        --card-bg: #1e293b;
        --text: #e2e8f0;
        --text-light: #94a3b8;
        --border: #334155;
        --code-bg: #334155;
        --recommendation-bg: #14532d;
        --recommendation-border: #166534;
        --hover-bg: #1e293b;
        --diff-source-border: #60a5fa;
        --diff-target-border: #fbbf24;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .report-header {
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid var(--border);
    }

    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .report-header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }

    .theme-toggle {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.4rem;
      cursor: pointer;
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      flex-shrink: 0;
    }

    .theme-toggle:hover { background: var(--hover-bg); border-color: var(--text-light); }

    .theme-icon-light { display: inline-block; }
    .theme-icon-dark { display: none; }
    [data-theme="dark"] .theme-icon-light { display: none !important; }
    [data-theme="dark"] .theme-icon-dark { display: inline-block !important; }
    [data-theme="light"] .theme-icon-light { display: inline-block !important; }
    [data-theme="light"] .theme-icon-dark { display: none !important; }

    .locale-badge {
      display: inline-block;
      background: var(--total);
      color: white;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.1rem 0.5rem;
      border-radius: 4px;
      vertical-align: middle;
      text-transform: uppercase;
    }

    .locale-inline {
      color: var(--text-light);
      font-weight: 600;
      text-transform: uppercase;
    }

    .report-meta {
      color: var(--text-light);
      font-size: 0.9rem;
      word-break: break-all;
    }

    h2 { font-size: 1.3rem; margin: 2rem 0 1rem; }

    .summary-cards {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .summary-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.5rem;
      min-width: 100px;
      text-decoration: none;
      color: inherit;
      transition: box-shadow 0.15s, transform 0.15s;
    }

    .summary-card.clickable { cursor: pointer; }
    .summary-card.clickable:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    }

    .summary-card .count { font-size: 2rem; font-weight: 700; }
    .summary-card .label {
      font-size: 0.85rem;
      color: var(--text-light);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .summary-card.critical .count { color: var(--critical); }
    .summary-card.major .count { color: var(--major); }
    .summary-card.minor .count { color: var(--minor); }
    .summary-card.warning .count { color: var(--warning); }
    .summary-card.cosmetic .count { color: var(--cosmetic); }
    .summary-card.total .count { color: var(--total); }

    /* --- Filters --- */
    .filters {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--bg);
      padding: 1rem 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1rem;
    }

    .filters-row {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .filter-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-light);
    }

    .filter-buttons {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .filter-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--card-bg);
      color: var(--text-light);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
    }

    .filter-btn:hover:not(:disabled) { border-color: var(--text-light); }
    .filter-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .filter-btn.active { background: var(--text); color: white; border-color: var(--text); }

    .filter-dot, .sev-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .filter-dot-untranslated { background: var(--cat-untranslated); }
    .filter-dot-layout { background: var(--cat-layout); }
    .filter-dot-missing { background: var(--cat-missing); }
    .filter-dot-accessibility { background: var(--cat-accessibility); }
    .filter-dot-functionality { background: var(--cat-functionality); }

    .sev-dot-critical { background: var(--critical); }
    .sev-dot-major { background: var(--major); }
    .sev-dot-minor { background: var(--minor); }
    .sev-dot-warning { background: var(--warning); }
    .sev-dot-cosmetic { background: var(--cosmetic); }

    .filter-count {
      background: rgba(0,0,0,0.1);
      padding: 0.05rem 0.4rem;
      border-radius: 10px;
      font-size: 0.75rem;
    }

    .filter-btn.active .filter-count { background: rgba(255,255,255,0.2); }

    .controls-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .search-box {
      flex: 1;
      min-width: 200px;
      position: relative;
    }

    .search-box input {
      width: 100%;
      padding: 0.4rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 0.85rem;
      background: var(--card-bg);
      color: var(--text);
      transition: border-color 0.15s;
    }

    .search-box input:focus {
      outline: none;
      border-color: var(--total);
      box-shadow: 0 0 0 2px rgba(37,99,235,0.15);
    }

    .search-count {
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.75rem;
      color: var(--text-light);
    }

    .global-controls {
      display: flex;
      gap: 0.4rem;
    }

    .ctrl-btn {
      padding: 0.3rem 0.65rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--card-bg);
      color: var(--text-light);
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.15s;
    }

    .ctrl-btn:hover { border-color: var(--text-light); color: var(--text); }

    /* --- Screenshots --- */
    .screenshots {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-top: 1.5rem;
    }

    .screenshot-tabs {
      display: flex;
      align-items: center;
      gap: 0;
      border-bottom: 1px solid var(--border);
      padding: 0 0.5rem;
    }

    .screenshot-tab {
      padding: 0.6rem 1.25rem;
      font-size: 0.85rem;
      font-weight: 600;
      border: none;
      border-bottom: 2px solid transparent;
      background: none;
      color: var(--text-light);
      cursor: pointer;
      transition: all 0.15s;
    }

    .screenshot-tab:hover { color: var(--text); }
    .screenshot-tab:focus-visible { outline: 2px solid var(--total); outline-offset: -2px; }
    .screenshot-tab.active { color: var(--total); border-bottom-color: var(--total); }

    .download-btn {
      margin-left: auto;
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
      font-weight: 500;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--card-bg);
      color: var(--text-light);
      cursor: pointer;
      transition: all 0.15s;
    }

    .download-btn:hover { border-color: var(--text); color: var(--text); }

    .screenshot-pane {
      display: none;
      max-height: 70vh;
      overflow-y: auto;
    }

    .screenshot-pane.active { display: block; }

    .screenshot-pane img {
      width: 100%;
      height: auto;
      display: block;
    }

    .screenshot-sidebyside {
      display: none;
      max-height: 70vh;
    }

    .screenshot-sidebyside.active {
      display: flex;
    }

    .sbs-panel {
      flex: 1;
      overflow: auto;
      max-height: 70vh;
      border-right: 1px solid var(--border);
    }

    .sbs-panel:last-child { border-right: none; }

    .sbs-label {
      position: sticky;
      top: 0;
      background: var(--bg);
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-light);
      border-bottom: 1px solid var(--border);
      z-index: 1;
    }

    .sbs-panel img {
      width: 100%;
      height: auto;
      display: block;
    }

    /* --- Findings --- */
    .finding-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-left: 4px solid var(--cosmetic);
      border-radius: var(--radius);
      margin-bottom: 0.5rem;
    }

    .finding-card.severity-critical { border-left-color: var(--critical); }
    .finding-card.severity-major { border-left-color: var(--major); }
    .finding-card.severity-minor { border-left-color: var(--minor); }
    .finding-card.severity-warning { border-left-color: var(--warning); }
    .finding-card.severity-cosmetic { border-left-color: var(--cosmetic); }

    .finding-summary {
      padding: 0.75rem 1rem;
      cursor: pointer;
      user-select: none;
    }

    .finding-summary:hover { background: var(--hover-bg); }

    .finding-body {
      display: none;
      padding: 0 1rem 1rem;
    }

    .finding-card.expanded .finding-body { display: block; }

    .expand-icon {
      margin-left: auto;
      display: inline-block;
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 5px solid var(--text-light);
      transition: transform 0.15s;
    }

    .finding-card.expanded .expand-icon { transform: rotate(180deg); }

    .finding-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .badge {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      color: white;
    }

    .badge-critical { background: var(--critical); }
    .badge-major { background: var(--major); }
    .badge-minor { background: var(--minor); }
    .badge-warning { background: var(--warning); }
    .badge-cosmetic { background: var(--cosmetic); }
    .badge-untranslated { background: var(--cat-untranslated); }
    .badge-layout { background: var(--cat-layout); }
    .badge-missing { background: var(--cat-missing); }
    .badge-accessibility { background: var(--cat-accessibility); }
    .badge-functionality { background: var(--cat-functionality); }

    .confidence {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--text-light);
    }

    .finding-title { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.5rem; }

    .finding-description {
      color: var(--text-light);
      margin-bottom: 0.75rem;
      font-size: 0.9rem;
    }

    .finding-detail { margin-bottom: 0.5rem; font-size: 0.9rem; }

    .finding-detail code {
      background: var(--code-bg);
      padding: 0.1rem 0.3rem;
      border-radius: 3px;
      font-size: 0.85rem;
    }

    .finding-selector {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .copy-btn {
      padding: 0.15rem 0.5rem;
      font-size: 0.7rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--card-bg);
      color: var(--text-light);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .copy-btn:hover { border-color: var(--text-light); color: var(--text); }
    .copy-btn.copied { background: #059669; color: white; border-color: #059669; }

    .finding-diff {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin: 0.75rem 0;
    }

    .diff-source, .diff-target { font-size: 0.85rem; }

    .diff-source pre, .diff-target pre {
      background: var(--code-bg);
      padding: 0.5rem;
      border-radius: 4px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.8rem;
      margin-top: 0.25rem;
    }

    .diff-source pre { border-left: 3px solid var(--diff-source-border); }
    .diff-target pre { border-left: 3px solid var(--diff-target-border); }

    .diff-del {
      background: #fecaca;
      color: #991b1b;
      text-decoration: line-through;
      border-radius: 2px;
      padding: 0 1px;
    }

    .diff-add {
      background: #bbf7d0;
      color: #14532d;
      border-radius: 2px;
      padding: 0 1px;
    }

    [data-theme="dark"] .diff-del { background: #7f1d1d; color: #fecaca; }
    [data-theme="dark"] .diff-add { background: #14532d; color: #bbf7d0; }

    .finding-recommendation {
      background: var(--recommendation-bg);
      border: 1px solid var(--recommendation-border);
      border-radius: 4px;
      padding: 0.75rem;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }

    .finding-recommendation p { margin-top: 0.25rem; }

    .severity-heading {
      padding-left: 0.5rem;
      border-left: 4px solid var(--cosmetic);
    }

    .severity-heading.severity-critical { border-left-color: var(--critical); }
    .severity-heading.severity-major { border-left-color: var(--major); }
    .severity-heading.severity-minor { border-left-color: var(--minor); }
    .severity-heading.severity-warning { border-left-color: var(--warning); }
    .severity-heading.severity-cosmetic { border-left-color: var(--cosmetic); }

    .no-findings {
      text-align: center;
      padding: 3rem;
      color: var(--text-light);
    }

    .no-findings h2 { color: #059669; }

    .report-footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-light);
      font-size: 0.85rem;
    }

    @media (max-width: 768px) {
      body { padding: 1rem; }
      .summary-cards { flex-direction: column; }
      .finding-diff { grid-template-columns: 1fr; }
      .filters-row { flex-direction: column; }
      .screenshot-sidebyside.active { flex-direction: column; }
      .sbs-panel { max-height: 50vh; border-right: none; border-bottom: 1px solid var(--border); }
    }

    @media print {
      .filters, .download-btn, .theme-toggle, .global-controls, .search-box { display: none !important; }
      .screenshot-pane { max-height: none !important; overflow: visible !important; }
      .finding-card { break-inside: avoid; }
      .finding-card .finding-body { display: block !important; }
      body { padding: 0; }
    }
  `;
}
