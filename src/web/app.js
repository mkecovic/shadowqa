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
const reportNewTab = document.getElementById("reportNewTab");
const historySection = document.getElementById("historySection");
const historyList = document.getElementById("historyList");

// Map server status messages to step numbers
function getStepFromStatus(status) {
  if (!status) return 0;
  const s = status.toLowerCase();
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

  steps.forEach(function (step, idx) {
    var stepNum = parseInt(step.getAttribute("data-step"));
    step.classList.remove("active", "completed");

    if (currentStep >= stepNum + 0.5) {
      step.classList.add("completed");
      // Replace circle content with checkmark
      var circle = step.querySelector(".step-circle");
      circle.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
    } else if (currentStep >= stepNum - 0.5 && currentStep < stepNum + 0.5) {
      step.classList.add("active");
    }
  });

  lines.forEach(function (line, idx) {
    line.classList.remove("completed");
    // Line between step idx+1 and idx+2
    if (currentStep >= idx + 2) {
      line.classList.add("completed");
    }
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const sourceUrl = document.getElementById("sourceUrl").value.trim();
  const targetUrl = document.getElementById("targetUrl").value.trim();
  const viewportSelect = document.getElementById("viewport");
  const viewportParts = viewportSelect.value.split("x");
  const viewport = { width: parseInt(viewportParts[0], 10), height: parseInt(viewportParts[1], 10) };

  if (!sourceUrl || !targetUrl) return;

  // Reset UI
  errorEl.classList.add("hidden");
  successCard.classList.add("hidden");
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
    const response = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceUrl, targetUrl, viewport }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to start comparison");
    }

    const { jobId } = await response.json();

    await pollProgress(jobId);
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Compare";
  }
});

async function pollProgress(jobId) {
  const pollInterval = 1000;
  const maxPolls = 120;

  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollInterval);

    const response = await fetch(`/api/status/${jobId}`);
    if (!response.ok) {
      throw new Error("Failed to check status");
    }

    const job = await response.json();

    // Update progress UI
    progressFill.style.width = `${job.progress}%`;
    progressStatus.textContent = job.status;

    // Update steps
    var step = getStepFromStatus(job.status);
    updateSteps(step);

    if (job.status === "complete") {
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
  const reportUrl = `/api/reports/${jobId}`;
  reportLink.href = reportUrl;
  reportNewTab.href = reportUrl;
  successMeta.textContent = `Job ${jobId.slice(0, 8)}...`;
  successCard.classList.remove("hidden");
}

function showError(message) {
  progressEl.classList.add("hidden");

  var title = "Something went wrong";
  var suggestion = "";

  var msgLower = (message || "").toLowerCase();

  if (msgLower.includes("timeout") || msgLower.includes("timed out")) {
    title = "Request timed out";
    suggestion =
      "The page may be too slow to load. Try a simpler page or check your internet connection.";
  } else if (
    msgLower.includes("net::") ||
    msgLower.includes("econnrefused") ||
    msgLower.includes("enotfound") ||
    msgLower.includes("network")
  ) {
    title = "Network error";
    suggestion =
      "Could not reach the URL. Check that the URL is correct and the site is accessible.";
  } else if (msgLower.includes("invalid url")) {
    title = "Invalid URL";
    suggestion =
      "Make sure both URLs start with https:// and are properly formatted.";
  } else if (msgLower.includes("navigation")) {
    title = "Page failed to load";
    suggestion =
      "The browser could not load this page. It may be blocking automated access.";
  }

  errorTitle.textContent = title;
  errorMessage.textContent = message;
  errorSuggestion.textContent = suggestion;
  errorEl.classList.remove("hidden");
}

errorRetry.addEventListener("click", function () {
  errorEl.classList.add("hidden");
  form.dispatchEvent(new Event("submit"));
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- History ---
async function loadHistory() {
  try {
    const response = await fetch("/api/reports");
    if (!response.ok) return;
    const reports = await response.json();
    if (!reports || reports.length === 0) {
      historySection.classList.add("hidden");
      return;
    }

    historyList.innerHTML = "";
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
      link.href = `/api/reports/${r.id}`;
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
        total +
        " issue" +
        (total !== 1 ? "s" : "") +
        "</span>" +
        (vpLabel ? '<span class="history-viewport">' + escapeHtml(vpLabel) + "</span>" : "") +
        "</div>" +
        "</div>" +
        '<span class="history-time">' +
        escapeHtml(time) +
        "</span>";

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

    historySection.classList.remove("hidden");
  } catch (e) {
    // Silently fail
  }
}

async function deleteReport(id) {
  try {
    const response = await fetch(`/api/reports/${id}`, { method: "DELETE" });
    if (response.ok) {
      loadHistory();
    }
  } catch (e) {
    // Silently fail
  }
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

function escapeHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Load history on page init
loadHistory();
