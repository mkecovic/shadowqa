// --- Dark mode ---
(function initTheme() {
  var themeToggle = document.getElementById("themeToggle");
  var savedTheme = localStorage.getItem("shadowqa-theme");
  if (
    savedTheme === "dark" ||
    (!savedTheme &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  ) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
  }
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var isDark =
        document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("shadowqa-theme", "light");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("shadowqa-theme", "dark");
      }
    });
  }
})();

// --- Tab switching ---
var tabBtns = document.querySelectorAll(".tab-btn");
var tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach(function (btn) {
  btn.addEventListener("click", function () {
    var tab = btn.getAttribute("data-tab");
    tabBtns.forEach(function (b) { b.classList.remove("active"); });
    tabPanels.forEach(function (p) { p.classList.remove("active"); });
    btn.classList.add("active");
    document.getElementById("tab-" + tab).classList.add("active");
  });
});

// --- Single compare elements ---
const form = document.getElementById("compareForm");
const submitBtn = document.getElementById("submitBtn");
const progressEl = document.getElementById("progress");
const progressFill = document.getElementById("progressFill");
const progressStatus = document.getElementById("progressStatus");
const stepsIndicator = document.getElementById("stepsIndicator");
const errorEl = document.getElementById("error");
const errorTitle = document.getElementById("errorTitle");
const errorMessage = document.getElementById("errorMessage");
const errorSuggestion = document.getElementById("errorSuggestion");
const errorRetry = document.getElementById("errorRetry");
const successCard = document.getElementById("successCard");
const successMeta = document.getElementById("successMeta");
const reportLink = document.getElementById("reportLink");
const historySection = document.getElementById("historySection");
const historyList = document.getElementById("historyList");

// --- Batch elements ---
const bulkPairsEl = document.getElementById("bulkPairs");
const csvUpload = document.getElementById("csvUpload");
const csvFileName = document.getElementById("csvFileName");
const bulkSubmitBtn = document.getElementById("bulkSubmitBtn");
const bulkPairCount = document.getElementById("bulkPairCount");
const batchProgressEl = document.getElementById("batchProgress");
const batchProgressFill = document.getElementById("batchProgressFill");
const batchProgressStatus = document.getElementById("batchProgressStatus");
const batchJobList = document.getElementById("batchJobList");
const batchSuccessCard = document.getElementById("batchSuccessCard");
const batchSuccessMeta = document.getElementById("batchSuccessMeta");
const batchSummaryLink = document.getElementById("batchSummaryLink");

// --- Sitemap elements ---
const discoverBtn = document.getElementById("discoverBtn");
const sitemapReview = document.getElementById("sitemapReview");
const discoveredCount = document.getElementById("discoveredCount");
const sitemapPairsList = document.getElementById("sitemapPairsList");
const selectAllBtn = document.getElementById("selectAllBtn");
const deselectAllBtn = document.getElementById("deselectAllBtn");
const sitemapBatchBtn = document.getElementById("sitemapBatchBtn");

// --- Utilities ---
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function getViewportFromSelect(selectId) {
  var sel = document.getElementById(selectId);
  var parts = sel.value.split("x");
  return { width: parseInt(parts[0], 10), height: parseInt(parts[1], 10) };
}

function parsePairsText(text) {
  return text
    .split("\n")
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line && !line.startsWith("#"); })
    .map(function (line) {
      // Support comma, tab, or pipe separator
      var parts = line.split(/[,\t|]/).map(function (s) { return s.trim(); });
      if (parts.length >= 2) {
        return { sourceUrl: parts[0], targetUrl: parts[1] };
      }
      return null;
    })
    .filter(function (p) { return p !== null; });
}

function shortenUrl(url) {
  try {
    var u = new URL(url);
    var path = u.pathname === "/" ? "" : u.pathname;
    return u.hostname + path;
  } catch {
    return url;
  }
}

function escapeHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatTimeAgo(timestamp) {
  try {
    var date = new Date(timestamp);
    var now = new Date();
    var diffMs = now - date;
    var diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return diffMin + "m ago";
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + "h ago";
    var diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return diffDay + "d ago";
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

// =====================
// SINGLE COMPARE
// =====================

function getStepFromStatus(status) {
  if (!status) return 0;
  var s = status.toLowerCase();
  if (s.includes("capturing source")) return 1;
  if (s.includes("source page captured")) return 1.5;
  if (s.includes("capturing target")) return 2;
  if (s.includes("target page captured")) return 2.5;
  if (s.includes("capturing pages")) return 1;
  if (s.includes("pages captured")) return 2.5;
  if (s.includes("compar") || s.includes("analy") || s.includes("scor") || s.includes("explain")) return 3;
  if (s.includes("generat") || s.includes("report")) return 4;
  if (s === "complete") return 5;
  return 0;
}

function updateSteps(currentStep) {
  var steps = stepsIndicator.querySelectorAll(".step");
  var lines = stepsIndicator.querySelectorAll(".step-line");

  steps.forEach(function (step) {
    var stepNum = parseInt(step.getAttribute("data-step"));
    step.classList.remove("active", "completed");

    if (currentStep >= stepNum + 0.5) {
      step.classList.add("completed");
      var circle = step.querySelector(".step-circle");
      circle.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
    } else if (currentStep >= stepNum - 0.5 && currentStep < stepNum + 0.5) {
      step.classList.add("active");
    }
  });

  lines.forEach(function (line, idx) {
    line.classList.remove("completed");
    if (currentStep >= idx + 2) {
      line.classList.add("completed");
    }
  });
}

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  var sourceUrl = document.getElementById("sourceUrl").value.trim();
  var targetUrl = document.getElementById("targetUrl").value.trim();
  var viewport = getViewportFromSelect("viewport");

  if (!sourceUrl || !targetUrl) return;

  // Reset UI
  errorEl.classList.add("hidden");
  successCard.classList.add("hidden");
  batchSuccessCard.classList.add("hidden");
  batchProgressEl.classList.add("hidden");
  progressEl.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressStatus.textContent = "Starting comparison...";
  submitBtn.disabled = true;
  submitBtn.textContent = "Comparing...";

  // Reset step indicators
  stepsIndicator.querySelectorAll(".step").forEach(function (step) {
    step.classList.remove("active", "completed");
    var circle = step.querySelector(".step-circle");
    circle.textContent = step.getAttribute("data-step");
  });
  stepsIndicator.querySelectorAll(".step-line").forEach(function (line) {
    line.classList.remove("completed");
  });

  try {
    var response = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceUrl: sourceUrl, targetUrl: targetUrl, viewport: viewport }),
    });

    if (!response.ok) {
      var data = await response.json();
      throw new Error(data.error || "Failed to start comparison");
    }

    var result = await response.json();
    await pollProgress(result.jobId);
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Compare";
  }
});

async function animateRemainingSteps(currentStep) {
  var stepLabels = ["", "Capturing source...", "Capturing target...", "Analyzing...", "Generating report..."];
  var stepProgress = [0, 20, 40, 65, 85];
  var startFrom = Math.floor(currentStep) + 1;
  for (var s = startFrom; s <= 4; s++) {
    progressStatus.textContent = stepLabels[s];
    progressFill.style.width = stepProgress[s] + "%";
    updateSteps(s);
    await sleep(400);
  }
  progressFill.style.width = "100%";
  progressStatus.textContent = "Complete!";
  updateSteps(5);
  await sleep(300);
}

async function pollProgress(jobId) {
  var pollInterval = 1000;
  var maxPolls = 120;

  for (var i = 0; i < maxPolls; i++) {
    await sleep(pollInterval);

    var response = await fetch("/api/status/" + jobId);
    if (!response.ok) {
      throw new Error("Failed to check status");
    }

    var job = await response.json();

    progressFill.style.width = job.progress + "%";
    progressStatus.textContent = job.status;

    var step = getStepFromStatus(job.status);
    updateSteps(step);

    if (job.status === "complete") {
      await animateRemainingSteps(step);
      progressEl.classList.add("hidden");
      showSuccess(jobId);
      loadHistory();
      return;
    }

    if (job.status === "error") {
      progressEl.classList.add("hidden");
      throw new Error(job.error || "Comparison failed");
    }
  }

  throw new Error("Comparison timed out");
}

function showSuccess(jobId) {
  var reportUrl = "/api/reports/" + jobId;
  reportLink.href = reportUrl;
  successMeta.textContent = "Job " + jobId.slice(0, 8) + "...";
  successCard.classList.remove("hidden");
}

function showError(message) {
  progressEl.classList.add("hidden");
  batchProgressEl.classList.add("hidden");

  var title = "Something went wrong";
  var suggestion = "";

  var msgLower = (message || "").toLowerCase();

  if (msgLower.includes("timeout") || msgLower.includes("timed out")) {
    title = "Request timed out";
    suggestion = "The page may be too slow to load. Try a simpler page or check your internet connection.";
  } else if (msgLower.includes("net::") || msgLower.includes("econnrefused") || msgLower.includes("enotfound") || msgLower.includes("network")) {
    title = "Network error";
    suggestion = "Could not reach the URL. Check that the URL is correct and the site is accessible.";
  } else if (msgLower.includes("invalid url")) {
    title = "Invalid URL";
    suggestion = "Make sure both URLs start with https:// and are properly formatted.";
  } else if (msgLower.includes("navigation")) {
    title = "Page failed to load";
    suggestion = "The browser could not load this page. It may be blocking automated access.";
  }

  errorTitle.textContent = title;
  errorMessage.textContent = message;
  errorSuggestion.textContent = suggestion;
  errorEl.classList.remove("hidden");
}

errorRetry.addEventListener("click", function () {
  errorEl.classList.add("hidden");
});

// =====================
// BULK COMPARE
// =====================

// Update pair count as user types
bulkPairsEl.addEventListener("input", updateBulkPairCount);

function updateBulkPairCount() {
  var pairs = parsePairsText(bulkPairsEl.value);
  if (pairs.length > 0) {
    bulkPairCount.textContent = pairs.length + " pair" + (pairs.length !== 1 ? "s" : "");
  } else {
    bulkPairCount.textContent = "";
  }
}

// CSV file upload
csvUpload.addEventListener("change", function (e) {
  var file = e.target.files[0];
  if (!file) return;

  csvFileName.textContent = file.name;

  var reader = new FileReader();
  reader.onload = function (evt) {
    var text = evt.target.result;
    // Skip header row if it looks like one
    var lines = text.split("\n");
    if (lines.length > 0 && (lines[0].toLowerCase().includes("source") || lines[0].toLowerCase().includes("url"))) {
      lines = lines.slice(1);
    }
    bulkPairsEl.value = lines.join("\n");
    updateBulkPairCount();
  };
  reader.readAsText(file);
});

// Start batch
bulkSubmitBtn.addEventListener("click", async function () {
  var pairs = parsePairsText(bulkPairsEl.value);
  if (pairs.length === 0) {
    showError("No valid URL pairs found. Enter one pair per line, separated by comma.");
    return;
  }

  // Validate URLs
  for (var i = 0; i < pairs.length; i++) {
    try {
      new URL(pairs[i].sourceUrl);
      new URL(pairs[i].targetUrl);
    } catch {
      showError("Invalid URL on line " + (i + 1) + ": " + pairs[i].sourceUrl + ", " + pairs[i].targetUrl);
      return;
    }
  }

  var viewport = getViewportFromSelect("bulkViewport");

  errorEl.classList.add("hidden");
  successCard.classList.add("hidden");
  batchSuccessCard.classList.add("hidden");
  progressEl.classList.add("hidden");
  bulkSubmitBtn.disabled = true;
  bulkSubmitBtn.textContent = "Starting...";

  try {
    var response = await fetch("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs: pairs, viewport: viewport }),
    });

    if (!response.ok) {
      var data = await response.json();
      throw new Error(data.error || "Failed to start batch");
    }

    var result = await response.json();
    await pollBatchProgress(result.batchId);
  } catch (err) {
    showError(err.message);
  } finally {
    bulkSubmitBtn.disabled = false;
    bulkSubmitBtn.textContent = "Start Batch";
  }
});

async function pollBatchProgress(batchId) {
  batchProgressEl.classList.remove("hidden");
  batchProgressFill.style.width = "0%";
  batchProgressStatus.textContent = "Starting batch...";
  batchJobList.innerHTML = "";

  var maxPolls = 600; // 10 minutes at 1s intervals
  for (var i = 0; i < maxPolls; i++) {
    await sleep(2000);

    var response = await fetch("/api/batch/" + batchId);
    if (!response.ok) {
      throw new Error("Failed to check batch status");
    }

    var batch = await response.json();

    // Update overall progress
    var totalProgress = batch.totalJobs > 0
      ? ((batch.completedJobs + batch.failedJobs) / batch.totalJobs * 100)
      : 0;
    batchProgressFill.style.width = totalProgress + "%";
    batchProgressStatus.textContent =
      batch.completedJobs + "/" + batch.totalJobs + " complete" +
      (batch.failedJobs > 0 ? " (" + batch.failedJobs + " failed)" : "");

    // Update per-job list
    renderBatchJobs(batch.jobs);

    if (batch.status === "complete" || batch.status === "error") {
      batchProgressEl.classList.add("hidden");
      showBatchSuccess(batchId, batch);
      loadHistory();
      return;
    }
  }

  throw new Error("Batch timed out");
}

function renderBatchJobs(jobs) {
  batchJobList.innerHTML = "";
  jobs.forEach(function (job) {
    var row = document.createElement("div");
    row.className = "batch-job-row";

    var urls = document.createElement("span");
    urls.className = "job-urls";
    urls.textContent = shortenUrl(job.sourceUrl) + " \u2192 " + shortenUrl(job.targetUrl);

    var statusBadge = document.createElement("span");
    statusBadge.className = "job-status job-status-" + job.status;
    statusBadge.textContent = job.status;

    row.appendChild(urls);
    row.appendChild(statusBadge);

    if (job.reportId && job.status === "complete") {
      var link = document.createElement("a");
      link.className = "job-link";
      link.href = "/api/reports/" + job.reportId;
      link.textContent = "View";
      row.appendChild(link);
    }

    batchJobList.appendChild(row);
  });
}

function showBatchSuccess(batchId, batch) {
  batchSuccessMeta.textContent =
    batch.completedJobs + " of " + batch.totalJobs + " pages completed" +
    (batch.failedJobs > 0 ? " (" + batch.failedJobs + " failed)" : "");
  batchSummaryLink.href = "/api/batch/" + batchId + "/summary";
  batchSuccessCard.classList.remove("hidden");
}

// =====================
// SITEMAP CRAWL
// =====================

var discoveredPairs = [];

discoverBtn.addEventListener("click", async function () {
  var sitemapUrl = document.getElementById("sitemapUrl").value.trim();
  var sourceLocale = document.getElementById("sourceLocale").value.trim();
  var targetLocale = document.getElementById("targetLocale").value.trim();

  if (!sitemapUrl || !sourceLocale || !targetLocale) {
    showError("Please enter a sitemap URL and both locale codes.");
    return;
  }

  errorEl.classList.add("hidden");
  sitemapReview.classList.add("hidden");
  discoverBtn.disabled = true;
  discoverBtn.textContent = "Discovering...";

  try {
    var response = await fetch("/api/sitemap/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sitemapUrl: sitemapUrl,
        sourceLocale: sourceLocale,
        targetLocale: targetLocale,
      }),
    });

    if (!response.ok) {
      var data = await response.json();
      throw new Error(data.error || "Failed to discover pairs");
    }

    var result = await response.json();
    discoveredPairs = result.pairs;

    if (discoveredPairs.length === 0) {
      showError("No URL pairs found in sitemap for the specified locales.");
      return;
    }

    renderDiscoveredPairs();
    sitemapReview.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    discoverBtn.disabled = false;
    discoverBtn.textContent = "Discover Pairs";
  }
});

function renderDiscoveredPairs() {
  discoveredCount.textContent = discoveredPairs.length + " pairs discovered";
  sitemapPairsList.innerHTML = "";

  discoveredPairs.forEach(function (pair, idx) {
    var row = document.createElement("div");
    row.className = "pair-row";

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.idx = idx;

    var urls = document.createElement("span");
    urls.className = "pair-urls";
    urls.innerHTML = escapeHtml(shortenUrl(pair.sourceUrl)) +
      '<span class="pair-arrow"> \u2192 </span>' +
      escapeHtml(shortenUrl(pair.targetUrl));

    row.appendChild(cb);
    row.appendChild(urls);
    sitemapPairsList.appendChild(row);
  });
}

selectAllBtn.addEventListener("click", function () {
  sitemapPairsList.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    cb.checked = true;
  });
});

deselectAllBtn.addEventListener("click", function () {
  sitemapPairsList.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    cb.checked = false;
  });
});

sitemapBatchBtn.addEventListener("click", async function () {
  var selectedPairs = [];
  sitemapPairsList.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    if (cb.checked) {
      var idx = parseInt(cb.dataset.idx, 10);
      selectedPairs.push({
        sourceUrl: discoveredPairs[idx].sourceUrl,
        targetUrl: discoveredPairs[idx].targetUrl,
      });
    }
  });

  if (selectedPairs.length === 0) {
    showError("No pairs selected. Check at least one pair to compare.");
    return;
  }

  var viewport = getViewportFromSelect("sitemapViewport");

  errorEl.classList.add("hidden");
  successCard.classList.add("hidden");
  batchSuccessCard.classList.add("hidden");
  sitemapBatchBtn.disabled = true;
  sitemapBatchBtn.textContent = "Starting...";

  try {
    var response = await fetch("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs: selectedPairs, viewport: viewport }),
    });

    if (!response.ok) {
      var data = await response.json();
      throw new Error(data.error || "Failed to start batch");
    }

    var result = await response.json();
    await pollBatchProgress(result.batchId);
  } catch (err) {
    showError(err.message);
  } finally {
    sitemapBatchBtn.disabled = false;
    sitemapBatchBtn.textContent = "Start Batch";
  }
});

// =====================
// HISTORY
// =====================

async function loadHistory() {
  try {
    var reports = [];
    var batches = [];

    var reportsRes = await fetch("/api/reports");
    if (reportsRes.ok) reports = await reportsRes.json();

    var batchesRes = await fetch("/api/batches");
    if (batchesRes.ok) batches = await batchesRes.json();

    if ((!reports || reports.length === 0) && (!batches || batches.length === 0)) {
      historySection.classList.add("hidden");
      return;
    }

    historyList.innerHTML = "";

    // Render batches
    if (batches && batches.length > 0) {
      batches.forEach(function (b) {
        var time = formatTimeAgo(b.createdAt);
        var item = document.createElement("div");
        item.className = "history-item";

        var link = document.createElement("a");
        link.className = "history-link";
        link.href = b.summaryReportId ? "/api/reports/" + b.summaryReportId : "#";

        var totalFindings = 0;
        // We don't have finding counts in batch meta directly, just job counts

        link.innerHTML =
          '<div class="history-urls">' +
          '<span class="history-url">Batch: ' + b.totalJobs + ' pages</span>' +
          '<div class="history-meta">' +
          '<span class="history-count ' + (b.failedJobs > 0 ? "has-issues" : "clean") + '">' +
          b.completedJobs + '/' + b.totalJobs + ' complete' +
          '</span>' +
          '<span class="history-viewport">' + b.viewport.width + ' x ' + b.viewport.height + '</span>' +
          '</div></div>' +
          '<span class="history-time">' + escapeHtml(time) + '</span>';

        item.appendChild(link);
        historyList.appendChild(item);
      });
    }

    // Render individual reports
    if (reports && reports.length > 0) {
      reports.forEach(function (r) {
        var total = r.summary ? r.summary.total : 0;
        var time = formatTimeAgo(r.timestamp);
        var sourceHost = shortenUrl(r.sourceUrl);
        var targetHost = shortenUrl(r.targetUrl);
        var vpLabel = r.viewport ? r.viewport.width + " x " + r.viewport.height : "";

        var item = document.createElement("div");
        item.className = "history-item";

        var link = document.createElement("a");
        link.className = "history-link";
        link.href = "/api/reports/" + r.id;
        link.innerHTML =
          '<div class="history-urls">' +
          '<span class="history-url">' +
          escapeHtml(sourceHost) +
          ' <span class="arrow">\u2192</span> ' +
          escapeHtml(targetHost) +
          "</span>" +
          '<div class="history-meta">' +
          '<span class="history-count ' +
          (total > 0 ? "has-issues" : "clean") +
          '">' +
          total + " issue" + (total !== 1 ? "s" : "") +
          "</span>" +
          (vpLabel ? '<span class="history-viewport">' + escapeHtml(vpLabel) + "</span>" : "") +
          "</div></div>" +
          '<span class="history-time">' + escapeHtml(time) + '</span>';

        var deleteBtn = document.createElement("button");
        deleteBtn.className = "history-delete";
        deleteBtn.title = "Delete report";
        deleteBtn.setAttribute("aria-label", "Delete report");
        deleteBtn.innerHTML = "&times;";
        deleteBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          deleteReport(r.id);
        });

        item.appendChild(link);
        item.appendChild(deleteBtn);
        historyList.appendChild(item);
      });
    }

    historySection.classList.remove("hidden");
  } catch (e) {
    // Silently fail
  }
}

async function deleteReport(id) {
  try {
    var response = await fetch("/api/reports/" + id, { method: "DELETE" });
    if (response.ok) {
      loadHistory();
    }
  } catch (e) {
    // Silently fail
  }
}

// Load history on page init
loadHistory();
