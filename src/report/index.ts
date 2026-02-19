import type { ComparisonReport, Finding } from "../types/index.js";

export function buildHtmlReport(report: ComparisonReport): string {
  const severityOrder = ["critical", "major", "normal", "minor", "trivial"] as const;
  const groupedFindings = new Map<string, Finding[]>();
  for (const sev of severityOrder) {
    groupedFindings.set(
      sev,
      report.findings.filter((f) => f.severity === sev)
    );
  }

  const categories = ["bleeding", "formatting", "functional", "source-issues"] as const;
  const categoryCounts = new Map<string, number>();
  for (const cat of categories) {
    categoryCounts.set(cat, report.findings.filter((f) => f.category === cat).length);
  }

  // Count pre-existing (source-issues) findings by axe impact level.
  // The source field is formatted as "<impact>: N element(s)" by the accessibility module.
  const preExistingCritical = report.findings.filter(
    (f) => f.category === "source-issues" && f.source.startsWith("critical:")
  ).length;
  const preExistingSerious = report.findings.filter(
    (f) => f.category === "source-issues" && f.source.startsWith("serious:")
  ).length;

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
  <button class="theme-toggle" id="themeToggle" title="Toggle dark mode" aria-label="Toggle dark mode">
    <svg class="theme-icon-light" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
    <svg class="theme-icon-dark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  </button>

  <header class="report-header">
    <div class="header-top">
      <a href="/" class="back-link">&larr; Back</a>
    </div>
    <div class="header-row">
      <h1>Shadow QA — Localization Report${localeDisplay}</h1>
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
    ${(preExistingCritical > 0 || preExistingSerious > 0) ? `
    <div class="preexisting-notice">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>
        Pre-existing accessibility issues on both pages (not caused by localization):
        ${preExistingCritical > 0 ? `<strong>${preExistingCritical} critical</strong>` : ""}${preExistingCritical > 0 && preExistingSerious > 0 ? ", " : ""}${preExistingSerious > 0 ? `<strong>${preExistingSerious} serious</strong>` : ""}.
        These are shown under <em>Source Issues</em> and should be fixed in the source page.
      </span>
    </div>` : ""}
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
            ${categoryLabel(cat)} <span class="filter-count">${count}</span>
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
      <div class="export-controls">
        <button class="ctrl-btn" id="exportJson">Export JSON</button>
        <button class="ctrl-btn" id="exportCsv">Export CSV</button>
      </div>
    </div>
  </section>

  <section class="screenshots">
    <div class="screenshot-tabs" role="tablist" aria-label="Screenshot views">
      <button class="screenshot-tab active" data-tab="annotated" role="tab" aria-selected="true" aria-controls="pane-annotated" id="tab-annotated" tabindex="0">Annotated</button>
      <button class="screenshot-tab" data-tab="source" role="tab" aria-selected="false" aria-controls="pane-source" id="tab-source" tabindex="-1">Source</button>
      <button class="screenshot-tab" data-tab="target" role="tab" aria-selected="false" aria-controls="pane-target" id="tab-target" tabindex="-1">Target</button>
      <button class="screenshot-tab" data-tab="diff" role="tab" aria-selected="false" aria-controls="pane-diff" id="tab-diff" tabindex="-1">Diff</button>
      <button class="screenshot-tab" data-tab="sidebyside" role="tab" aria-selected="false" aria-controls="pane-sidebyside" id="tab-sidebyside" tabindex="-1">Side by Side</button>
      <button class="download-btn" id="screenshotDownload" data-filename="annotated.png" data-src="data:image/png;base64,${report.annotatedScreenshot}">Download</button>
    </div>
    <div class="screenshot-pane active" data-pane="annotated" role="tabpanel" id="pane-annotated" aria-labelledby="tab-annotated">
      <img src="data:image/png;base64,${report.annotatedScreenshot}" alt="Annotated target screenshot with finding locations">
    </div>
    <div class="screenshot-pane" data-pane="source" role="tabpanel" id="pane-source" aria-labelledby="tab-source">
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

  <script>var REPORT_DATA = ${buildReportDataJson(report)};</script>
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
        <span class="badge badge-${f.category}">${categoryLabel(f.category)}</span>
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

const CATEGORY_LABELS: Record<string, string> = {
  bleeding: "Bleeding",
  formatting: "Formatting",
  functional: "Functional",
  "source-issues": "Source Issues",
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || capitalize(cat);
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

function buildReportDataJson(report: ComparisonReport): string {
  const data = {
    id: report.id,
    sourceUrl: report.sourceUrl,
    targetUrl: report.targetUrl,
    sourceLocale: report.sourceLocale || null,
    targetLocale: report.targetLocale || null,
    viewport: report.viewport,
    timestamp: report.timestamp,
    summary: report.summary,
    findings: report.findings,
  };
  return JSON.stringify(data);
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
        annotated: { filename: 'annotated.png', src: document.querySelector('[data-pane="annotated"] img').src },
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

      // --- Export JSON / CSV ---
      var exportJsonBtn = document.getElementById('exportJson');
      var exportCsvBtn = document.getElementById('exportCsv');

      var triggerDownload = function(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', function() {
          var json = JSON.stringify(REPORT_DATA, null, 2);
          var blob = new Blob([json], { type: 'application/json' });
          triggerDownload(blob, 'shadowqa-' + REPORT_DATA.id + '.json');
        });
      }

      if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', function() {
          var csvEscape = function(val) {
            var s = String(val == null ? '' : val);
            if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\\n') !== -1 || s.indexOf('\\r') !== -1) {
              return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          };
          var headers = ['ID','Category','Severity','Confidence','Title','Description','Impact','Recommendation','Element Selector','Element Tag','Source','Target'];
          var rows = [headers.join(',')];
          var findings = REPORT_DATA.findings || [];
          for (var i = 0; i < findings.length; i++) {
            var f = findings[i];
            rows.push([
              csvEscape(f.id),
              csvEscape(f.category),
              csvEscape(f.severity),
              csvEscape(f.confidence),
              csvEscape(f.title),
              csvEscape(f.description),
              csvEscape(f.impact),
              csvEscape(f.recommendation),
              csvEscape(f.element ? f.element.selector : ''),
              csvEscape(f.element ? f.element.tag : ''),
              csvEscape(f.source),
              csvEscape(f.target)
            ].join(','));
          }
          var csv = rows.join('\\r\\n');
          var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          triggerDownload(blob, 'shadowqa-' + REPORT_DATA.id + '.csv');
        });
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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    :root {
      --critical: #dc2626;
      --major: #ea580c;
      --normal: #ca8a04;
      --minor: #a16207;
      --trivial: #6b7280;
      --total: #2563eb;
      --cat-bleeding: #e11d48;
      --cat-formatting: #7c3aed;
      --cat-functional: #0891b2;
      --cat-source-issues: #d97706;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-light: #64748b;
      --border: #e2e8f0;
      --radius: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --code-bg: #f1f5f9;
      --recommendation-bg: #f0fdf4;
      --recommendation-border: #bbf7d0;
      --hover-bg: #f8fafc;
      --diff-source-border: #3b82f6;
      --diff-target-border: #f59e0b;

      --glass-bg: rgba(255, 255, 255, 0.6);
      --glass-border: rgba(255, 255, 255, 0.3);
      --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
      --glass-blur: blur(16px);
      --glass-hover-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
      --input-bg: rgba(255, 255, 255, 0.5);
      --input-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
      --gradient-1: #667eea;
      --gradient-2: #764ba2;
      --gradient-3: #f093fb;
      --gradient-4: #2563eb;
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

      --glass-bg: rgba(30, 41, 59, 0.6);
      --glass-border: rgba(148, 163, 184, 0.1);
      --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      --glass-hover-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
      --input-bg: rgba(30, 41, 59, 0.5);
      --input-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
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

        --glass-bg: rgba(30, 41, 59, 0.6);
        --glass-border: rgba(148, 163, 184, 0.1);
        --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        --glass-hover-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
        --input-bg: rgba(30, 41, 59, 0.5);
        --input-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
      position: relative;
    }

    /* Animated gradient background */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, var(--gradient-1), var(--gradient-2), var(--gradient-3), var(--gradient-4));
      background-size: 400% 400%;
      animation: gradientShift 15s ease infinite;
      opacity: 0.08;
      z-index: -2;
      pointer-events: none;
    }

    /* Noise texture overlay */
    body::after {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0.03;
      z-index: -1;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-repeat: repeat;
      background-size: 256px 256px;
    }

    @keyframes gradientShift {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(16px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .report-header {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      box-shadow: var(--glass-shadow);
      animation: fadeInUp 0.6s ease both;
    }

    .header-top {
      margin-bottom: 0.75rem;
    }

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

    .back-link:hover {
      color: var(--text);
    }

    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .report-header h1 {
      font-size: 1.75rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
      letter-spacing: -0.03em;
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
      box-shadow: var(--glass-hover-shadow);
    }

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

    h2 {
      font-size: 1.3rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 2rem 0 1rem;
    }

    .summary-cards {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }

    .preexisting-notice {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.6rem 0.9rem;
      background: color-mix(in srgb, var(--cat-source-issues) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--cat-source-issues) 35%, transparent);
      border-radius: 6px;
      font-size: 0.85rem;
      color: var(--text);
      margin-top: 0.75rem;
    }

    .preexisting-notice svg {
      flex-shrink: 0;
      margin-top: 2px;
      color: var(--cat-source-issues);
    }

    .summary-card {
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
      text-decoration: none;
      color: inherit;
      transition: box-shadow 0.2s, transform 0.2s;
      animation: fadeInUp 0.5s ease both;
    }

    .summary-card:nth-child(1) { animation-delay: 0.05s; }
    .summary-card:nth-child(2) { animation-delay: 0.1s; }
    .summary-card:nth-child(3) { animation-delay: 0.15s; }
    .summary-card:nth-child(4) { animation-delay: 0.2s; }
    .summary-card:nth-child(5) { animation-delay: 0.25s; }
    .summary-card:nth-child(6) { animation-delay: 0.3s; }

    .summary-card.clickable { cursor: pointer; }
    .summary-card.clickable:hover {
      box-shadow: var(--glass-hover-shadow);
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
    .summary-card.normal .count { color: var(--normal); }
    .summary-card.minor .count { color: var(--minor); }
    .summary-card.trivial .count { color: var(--trivial); }
    .summary-card.total .count { color: var(--total); }

    /* --- Filters --- */
    .filters {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--glass-shadow);
      padding: 1rem;
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
      border: 1px solid var(--glass-border);
      border-radius: 20px;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      color: var(--text-light);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      user-select: none;
    }

    .filter-btn:hover:not(:disabled) {
      border-color: var(--text-light);
      transform: translateY(-1px);
    }
    .filter-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .filter-btn.active { background: var(--text); color: var(--bg); border-color: var(--text); }
    [data-theme="dark"] .filter-btn.active { background: #e2e8f0; color: #0f172a; border-color: #e2e8f0; }

    .filter-dot, .sev-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .filter-dot-bleeding { background: var(--cat-bleeding); }
    .filter-dot-formatting { background: var(--cat-formatting); }
    .filter-dot-functional { background: var(--cat-functional); }
    .filter-dot-source-issues { background: var(--cat-source-issues); }

    .sev-dot-critical { background: var(--critical); }
    .sev-dot-major { background: var(--major); }
    .sev-dot-normal { background: var(--normal); }
    .sev-dot-minor { background: var(--minor); }
    .sev-dot-trivial { background: var(--trivial); }

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
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      font-size: 0.85rem;
      font-family: inherit;
      background: var(--input-bg);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-shadow: var(--input-shadow);
      color: var(--text);
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .search-box input:focus {
      outline: none;
      border-color: var(--total);
      box-shadow: var(--input-shadow), 0 0 0 3px rgba(37,99,235,0.15);
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

    .export-controls {
      display: flex;
      gap: 0.4rem;
    }

    .export-controls .ctrl-btn {
      background: linear-gradient(135deg, var(--gradient-1), var(--gradient-2));
      color: #fff;
      border-color: transparent;
      font-weight: 600;
    }

    .export-controls .ctrl-btn:hover {
      color: #fff;
      box-shadow: 0 4px 14px rgba(102, 126, 234, 0.4);
    }

    .ctrl-btn {
      padding: 0.3rem 0.65rem;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      color: var(--text-light);
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .ctrl-btn:hover {
      border-color: var(--text-light);
      color: var(--text);
      transform: translateY(-1px);
    }

    /* --- Screenshots --- */
    .screenshots {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--glass-shadow);
      margin-top: 1.5rem;
      animation: fadeInUp 0.5s ease 0.15s both;
    }

    .screenshot-tabs {
      display: flex;
      align-items: center;
      gap: 0;
      border-bottom: 1px solid var(--glass-border);
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
      font-family: inherit;
    }

    .screenshot-tab:hover { color: var(--text); }
    .screenshot-tab:focus-visible { outline: 2px solid var(--total); outline-offset: -2px; }
    .screenshot-tab.active { color: var(--total); border-bottom-color: var(--total); }

    .download-btn {
      margin-left: auto;
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
      font-weight: 500;
      border: 1px solid var(--glass-border);
      border-radius: 4px;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      color: var(--text-light);
      cursor: pointer;
      transition: all 0.2s;
    }

    .download-btn:hover {
      border-color: var(--text);
      color: var(--text);
      transform: translateY(-1px);
    }

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
      border-right: 1px solid var(--glass-border);
    }

    .sbs-panel:last-child { border-right: none; }

    .sbs-label {
      position: sticky;
      top: 0;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-light);
      border-bottom: 1px solid var(--glass-border);
      z-index: 1;
    }

    .sbs-panel img {
      width: 100%;
      height: auto;
      display: block;
    }

    /* --- Findings --- */
    .finding-card {
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--glass-border);
      border-left: 4px solid var(--trivial);
      border-radius: var(--radius-lg);
      box-shadow: var(--glass-shadow);
      margin-bottom: 0.75rem;
      transition: transform 0.2s, box-shadow 0.2s;
      animation: fadeInUp 0.4s ease both;
    }

    .finding-card:hover {
      transform: translateY(-1px);
      box-shadow: var(--glass-hover-shadow);
    }

    .finding-card.severity-critical { border-left-color: var(--critical); }
    .finding-card.severity-major { border-left-color: var(--major); }
    .finding-card.severity-normal { border-left-color: var(--normal); }
    .finding-card.severity-minor { border-left-color: var(--minor); }
    .finding-card.severity-trivial { border-left-color: var(--trivial); }

    .finding-summary {
      padding: 0.75rem 1rem;
      cursor: pointer;
      user-select: none;
      border-radius: var(--radius-lg);
    }

    .finding-summary:hover { background: rgba(0, 0, 0, 0.02); }
    [data-theme="dark"] .finding-summary:hover { background: rgba(255, 255, 255, 0.02); }

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
    .badge-normal { background: var(--normal); }
    .badge-minor { background: var(--minor); }
    .badge-trivial { background: var(--trivial); }
    .badge-bleeding { background: var(--cat-bleeding); }
    .badge-formatting { background: var(--cat-formatting); }
    .badge-functional { background: var(--cat-functional); }
    .badge-source-issues { background: var(--cat-source-issues); }

    .confidence {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--text-light);
    }

    .finding-title {
      font-size: 1.05rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      letter-spacing: -0.01em;
    }

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
      border: 1px solid var(--glass-border);
      border-radius: 4px;
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      color: var(--text-light);
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .copy-btn:hover {
      border-color: var(--text-light);
      color: var(--text);
      transform: translateY(-1px);
    }
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
      background: var(--glass-bg);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border: 1px solid var(--recommendation-border);
      border-radius: var(--radius);
      padding: 0.75rem;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }

    .finding-recommendation p { margin-top: 0.25rem; }

    .severity-heading {
      padding-left: 0.5rem;
      border-left: 4px solid var(--trivial);
    }

    .severity-heading.severity-critical { border-left-color: var(--critical); }
    .severity-heading.severity-major { border-left-color: var(--major); }
    .severity-heading.severity-normal { border-left-color: var(--normal); }
    .severity-heading.severity-minor { border-left-color: var(--minor); }
    .severity-heading.severity-trivial { border-left-color: var(--trivial); }

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

    /* --- Fallback for browsers without backdrop-filter --- */
    @supports not (backdrop-filter: blur(16px)) {
      .report-header,
      .summary-card,
      .filters,
      .filter-btn,
      .search-box input,
      .ctrl-btn,
      .screenshots,
      .finding-card,
      .theme-toggle,
      .download-btn,
      .copy-btn,
      .finding-recommendation,
      .badge,
      .sbs-label {
        background: var(--card-bg);
      }
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
      body::before, body::after { display: none !important; }
      .filters, .download-btn, .theme-toggle, .global-controls, .export-controls, .search-box, .back-link { display: none !important; }
      .screenshot-pane { max-height: none !important; overflow: visible !important; }
      .finding-card { break-inside: avoid; }
      .finding-card .finding-body { display: block !important; }
      body { padding: 0; }
    }
  `;
}
