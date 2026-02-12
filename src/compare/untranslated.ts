import type { PageCapture, RawFinding, TextNode } from "../types/index.js";
import { truncate } from "./utils.js";

// Unicode script ranges for detection
const SCRIPT_RANGES: Record<string, RegExp> = {
  latin: /[\u0041-\u024F]/,
  cjk: /[\u3000-\u9FFF\uF900-\uFAFF]/,
  arabic: /[\u0600-\u06FF\u0750-\u077F]/,
  cyrillic: /[\u0400-\u04FF]/,
  devanagari: /[\u0900-\u097F]/,
  thai: /[\u0E00-\u0E7F]/,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF]/,
  kana: /[\u3040-\u309F\u30A0-\u30FF]/,
};

// Map locales to their expected scripts
const LOCALE_SCRIPTS: Record<string, string[]> = {
  en: ["latin"], de: ["latin"], fr: ["latin"], es: ["latin"],
  pt: ["latin"], it: ["latin"], nl: ["latin"], pl: ["latin"],
  sv: ["latin"], da: ["latin"], fi: ["latin"], nb: ["latin"],
  no: ["latin"], tr: ["latin"], ro: ["latin"], cs: ["latin"],
  hu: ["latin"], vi: ["latin"], id: ["latin"], ms: ["latin"],
  ja: ["cjk", "kana"],
  zh: ["cjk"], "zh-cn": ["cjk"], "zh-tw": ["cjk"],
  ko: ["hangul", "cjk"],
  ar: ["arabic"], fa: ["arabic"], he: ["arabic"], ur: ["arabic"],
  ru: ["cyrillic"], uk: ["cyrillic"], bg: ["cyrillic"],
  sr: ["cyrillic"], be: ["cyrillic"],
  hi: ["devanagari"], mr: ["devanagari"], ne: ["devanagari"],
  th: ["thai"],
};

// Patterns to skip as false positives
const SKIP_PATTERNS = [
  /^\d+[\d.,\s%$]*$/, // numbers, prices, percentages
  /^https?:\/\//i, // URLs
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, // emails
  /^[#.]?[a-zA-Z_][\w-]*$/, // CSS selectors / identifiers
  /^\+?\d[\d\s()-]{5,}$/, // phone numbers
];

const CODE_TAGS = new Set(["code", "pre", "kbd", "samp", "var"]);

export function compareUntranslated(
  source: PageCapture,
  target: PageCapture,
  targetLocale?: string
): RawFinding[] {
  const sourceTextMap = indexTextNodes(source.textNodes);
  const targetTextMap = indexTextNodes(target.textNodes);
  const findings: RawFinding[] = [];

  const sourceLang = normalizeLang(source.lang);
  const targetLang = normalizeLang(targetLocale || target.lang);

  const sourceScripts = sourceLang ? (LOCALE_SCRIPTS[sourceLang] || []) : [];
  const targetScripts = targetLang ? (LOCALE_SCRIPTS[targetLang] || []) : [];

  // Do source and target expect different scripts?
  const differentScripts = sourceScripts.length > 0 && targetScripts.length > 0
    && !sourceScripts.some((s) => targetScripts.includes(s));

  for (const [selector, sourceNode] of sourceTextMap) {
    const targetNode = targetTextMap.get(selector);
    if (!targetNode) continue;

    const sourceText = sourceNode.text.trim();
    const targetText = targetNode.text.trim();

    // Skip if empty or too short
    if (sourceText.length < 3 || targetText.length < 3) continue;

    // Skip false positives
    if (shouldSkip(sourceText, sourceNode.tag)) continue;

    // Check if text is identical (potential untranslated string)
    if (sourceText === targetText) {
      const scriptMismatch = differentScripts && isInScripts(targetText, sourceScripts);
      const confidence = calculateConfidence(
        sourceText,
        targetNode,
        scriptMismatch
      );

      if (confidence > 0.4) {
        findings.push({
          category: "untranslated",
          title: `Untranslated text: "${truncate(sourceText, 50)}"`,
          description: `The text "${truncate(sourceText, 80)}" appears identically on both the source and target pages at "${selector}"`,
          element: { selector, tag: sourceNode.tag },
          source: truncate(sourceText, 120),
          target: truncate(targetText, 120),
          metadata: {
            type: "exact-match",
            textLength: sourceText.length,
            confidence,
            scriptMismatch,
            isInteractive: isInteractiveTag(sourceNode.tag),
            isHeading: isHeadingTag(sourceNode.tag),
          },
        });
      }
    } else if (differentScripts && isInScripts(targetText, sourceScripts)) {
      // Target text differs but is still in the source's script when we expect a different one
      const confidence = 0.7;
      findings.push({
        category: "untranslated",
        title: `Possibly untranslated: "${truncate(targetText, 50)}"`,
        description: `The text at "${selector}" uses ${sourceScripts.join("/")} script but the target locale (${targetLang}) expects ${targetScripts.join("/")}`,
        element: { selector, tag: targetNode.tag },
        source: truncate(sourceText, 120),
        target: truncate(targetText, 120),
        metadata: {
          type: "script-mismatch",
          textLength: targetText.length,
          confidence,
          scriptMismatch: true,
        },
      });
    }
  }

  return findings;
}

function indexTextNodes(nodes: TextNode[]): Map<string, TextNode> {
  const map = new Map<string, TextNode>();
  for (const node of nodes) {
    if (node.visible && node.text.trim().length > 0) {
      map.set(node.selector, node);
    }
  }
  return map;
}

function shouldSkip(text: string, tag: string): boolean {
  if (CODE_TAGS.has(tag)) return true;
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * Normalize a lang attribute to a base locale key.
 * e.g. "en-US" → "en", "zh-TW" → "zh-tw", "" → null
 */
function normalizeLang(lang: string | undefined): string | null {
  if (!lang) return null;
  const lower = lang.toLowerCase().trim();
  if (!lower) return null;
  // Try full tag first (zh-cn, zh-tw), then base language
  if (LOCALE_SCRIPTS[lower]) return lower;
  const base = lower.split("-")[0];
  if (LOCALE_SCRIPTS[base]) return base;
  return lower;
}

/**
 * Detect the dominant script of text.
 */
function detectScript(text: string): string | null {
  const letters = text.replace(/[\d\s\p{P}\p{S}]/gu, "");
  if (letters.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const [script, regex] of Object.entries(SCRIPT_RANGES)) {
    counts[script] = 0;
    for (const char of letters) {
      if (regex.test(char)) counts[script]++;
    }
  }

  let dominant: string | null = null;
  let maxCount = 0;
  for (const [script, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = script;
    }
  }
  return dominant;
}

/**
 * Check if text is predominantly written in any of the given scripts.
 */
function isInScripts(text: string, scripts: string[]): boolean {
  const dominant = detectScript(text);
  return dominant !== null && scripts.includes(dominant);
}

function calculateConfidence(
  text: string,
  targetNode: TextNode,
  scriptMismatch: boolean
): number {
  let confidence = 0.75; // base for exact match

  // Script mismatch → high confidence
  if (scriptMismatch) {
    return 0.95;
  }

  // Interactive/heading elements → bump up
  if (isInteractiveTag(targetNode.tag)) {
    confidence = Math.max(confidence, 0.85);
  }
  if (isHeadingTag(targetNode.tag)) {
    confidence = Math.max(confidence, 0.9);
  }

  // Short text → lower confidence (might be brand names, abbreviations)
  if (text.length <= 10) {
    confidence = Math.min(confidence, 0.5);
  }

  return confidence;
}

function isInteractiveTag(tag: string): boolean {
  return ["a", "button", "input", "select", "textarea", "summary"].includes(
    tag.toLowerCase()
  );
}

function isHeadingTag(tag: string): boolean {
  return /^h[1-6]$/i.test(tag);
}
