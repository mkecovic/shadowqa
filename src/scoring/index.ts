import type { Finding, RawFinding } from "../types/index.js";

type Severity = Finding["severity"];

interface ScoringResult {
  severity: Severity;
  confidence: number;
}

const INTERACTIVE_TAGS = new Set([
  "a", "button", "input", "select", "textarea", "form", "details", "summary",
]);

const LANDMARK_TAGS = new Set([
  "nav", "main", "header", "footer", "aside", "section", "article",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function scoreFinding(raw: RawFinding): ScoringResult {
  const meta = (raw.metadata || {}) as Record<string, any>;

  switch (raw.category) {
    case "bleeding":
      return scoreUntranslated(raw, meta);
    case "formatting":
      return scoreLayout(raw, meta);
    case "functional":
      return scoreFunctional(raw, meta);
    case "source-issues":
      return scoreSourceIssues(raw, meta);
    default:
      return { severity: "trivial", confidence: 0.4 };
  }
}

function scoreUntranslated(
  raw: RawFinding,
  meta: Record<string, any>
): ScoringResult {
  const scriptMismatch = meta.scriptMismatch as boolean | undefined;
  const textLength = (meta.textLength as number) || 0;
  const isInteractive = meta.isInteractive as boolean | undefined;
  const isHeading = meta.isHeading as boolean | undefined;

  if (scriptMismatch) {
    return { severity: "critical", confidence: 0.95 };
  }

  if (textLength <= 10) {
    return { severity: "normal", confidence: 0.5 };
  }

  if (isHeading) {
    return { severity: "critical", confidence: 0.9 };
  }
  if (isInteractive) {
    return { severity: "major", confidence: 0.85 };
  }

  return { severity: "major", confidence: 0.8 };
}

function scoreLayout(
  raw: RawFinding,
  meta: Record<string, any>
): ScoringResult {
  const type = meta.type as string | undefined;
  const tag = raw.element.tag.toLowerCase();
  const isInteractive = INTERACTIVE_TAGS.has(tag);
  const aboveFold = meta.aboveFold as boolean | undefined;

  if (type === "truncation") {
    if (isInteractive) return { severity: "critical", confidence: 0.85 };
    return { severity: "major", confidence: 0.8 };
  }

  if (type === "resize") {
    if (aboveFold) return { severity: "major", confidence: 0.75 };
    return { severity: "normal", confidence: 0.65 };
  }

  if (type === "overflow") {
    if (isInteractive) return { severity: "critical", confidence: 0.85 };
    return { severity: "major", confidence: 0.8 };
  }

  if (type === "overlap") {
    return { severity: "major", confidence: 0.7 };
  }

  return { severity: "normal", confidence: 0.6 };
}

function scoreMissing(
  raw: RawFinding,
  meta: Record<string, any>
): ScoringResult {
  const isInteractive = meta.isInteractive as boolean | undefined;
  const isLandmark = meta.isLandmark as boolean | undefined;
  const isHeading = meta.isHeading as boolean | undefined;

  if (isInteractive) {
    return { severity: "critical", confidence: 0.9 };
  }
  if (isLandmark || isHeading) {
    return { severity: "major", confidence: 0.8 };
  }
  return { severity: "normal", confidence: 0.65 };
}

function scoreFunctionality(
  raw: RawFinding,
  meta: Record<string, any>
): ScoringResult {
  const type = meta.type as string | undefined;

  if (type === "href-removed") {
    return { severity: "critical", confidence: 0.9 };
  }
  if (type === "tag-downgrade") {
    return { severity: "critical", confidence: 0.85 };
  }
  if (type === "href-not-localized") {
    return { severity: "major", confidence: 0.75 };
  }
  if (type === "href-changed") {
    return { severity: "major", confidence: 0.7 };
  }
  if (type === "state-change") {
    return { severity: "major", confidence: 0.8 };
  }
  if (type === "form-change") {
    return { severity: "major", confidence: 0.8 };
  }
  if (type === "tabindex-change") {
    return { severity: "major", confidence: 0.75 };
  }

  return { severity: "normal", confidence: 0.6 };
}

function scoreFunctional(
  raw: RawFinding,
  meta: Record<string, any>
): ScoringResult {
  const type = meta.type as string | undefined;

  // Dispatch based on metadata.type to the appropriate sub-scorer
  if (type === "missing") {
    return scoreMissing(raw, meta);
  }
  if (type === "new-violation" || type === "regression" || type === "violation-spread") {
    return scoreAccessibilityFunctional(raw, meta);
  }
  return scoreFunctionality(raw, meta);
}

function scoreAccessibilityFunctional(
  raw: RawFinding,
  meta: Record<string, any>
): ScoringResult {
  const impact = meta.impact as string | undefined;
  const type = meta.type as string | undefined;

  if (type === "regression") {
    if (impact === "critical") return { severity: "critical", confidence: 0.9 };
    return { severity: "major", confidence: 0.85 };
  }

  if (type === "new-violation") {
    if (impact === "critical") return { severity: "critical", confidence: 0.9 };
    if (impact === "serious") return { severity: "major", confidence: 0.8 };
    if (impact === "moderate") return { severity: "major", confidence: 0.7 };
    return { severity: "normal", confidence: 0.6 };
  }

  if (type === "violation-spread") {
    if (impact === "critical" || impact === "serious")
      return { severity: "major", confidence: 0.75 };
    return { severity: "normal", confidence: 0.6 };
  }

  return { severity: "major", confidence: 0.5 };
}

function scoreSourceIssues(
  raw: RawFinding,
  meta: Record<string, any>
): ScoringResult {
  const impact = meta.impact as string | undefined;

  if (impact === "critical") return { severity: "minor", confidence: 0.9 };
  if (impact === "serious") return { severity: "minor", confidence: 0.85 };
  return { severity: "minor", confidence: 0.7 };
}
