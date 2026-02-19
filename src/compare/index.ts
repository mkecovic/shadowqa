import type { PageCapture, RawFinding } from "../types/index.js";

/**
 * Removes redundant findings after all modules have run.
 *
 * Two dedup rules:
 *
 * 1. Exact-type duplicates — same (element.selector, metadata.type) pair.
 *    Guards against two modules independently flagging the same specific issue.
 *
 * 2. href-not-localized URL duplicates — same (sourceHref, targetHref) pair.
 *    A shared domain link can appear at dozens of selectors (nav items, footer links)
 *    that all passed the text-change guard. Keep only the first instance per unique
 *    URL pair so the report surfaces the pattern without repeating it.
 */
function deduplicateFindings(findings: RawFinding[]): RawFinding[] {
  const seenTypeKey = new Set<string>();
  const seenHrefPair = new Set<string>();
  const result: RawFinding[] = [];

  for (const f of findings) {
    const meta = (f.metadata || {}) as Record<string, unknown>;
    const type = (meta.type as string) || "unknown";

    // Rule 1 — exact (selector, type) duplicate
    const typeKey = `${f.element.selector}::${type}`;
    if (seenTypeKey.has(typeKey)) continue;
    seenTypeKey.add(typeKey);

    // Rule 2 — href-not-localized URL pair duplicate
    if (type === "href-not-localized") {
      const hrefPair = `${f.source}||${f.target}`;
      if (seenHrefPair.has(hrefPair)) continue;
      seenHrefPair.add(hrefPair);
    }

    result.push(f);
  }

  return result;
}
import { compareVisual } from "./visual.js";
import { compareUntranslated } from "./untranslated.js";
import { compareLayout } from "./layout.js";
import { compareMissing } from "./missing.js";
import { compareFunctionality } from "./functionality.js";
import { compareAccessibility } from "./accessibility.js";
import { annotateScreenshot } from "./annotate.js";

export interface CompareResult {
  findings: RawFinding[];
  diffImage: Buffer;
  annotatedScreenshot: Buffer;
}

export async function comparePages(
  source: PageCapture,
  target: PageCapture
): Promise<CompareResult> {
  // Auto-detect target locale from the page's <html lang> attribute
  const targetLocale = target.lang || undefined;

  const [
    visualResult,
    untranslatedFindings,
    layoutFindings,
    missingFindings,
    functionalityFindings,
    a11yFindings,
  ] = await Promise.all([
    compareVisual(source, target),
    Promise.resolve(compareUntranslated(source, target, targetLocale)),
    Promise.resolve(compareLayout(source, target)),
    Promise.resolve(compareMissing(source, target)),
    Promise.resolve(compareFunctionality(source, target)),
    Promise.resolve(compareAccessibility(source, target)),
  ]);

  const allFindings = deduplicateFindings([
    ...untranslatedFindings,
    ...layoutFindings,
    ...missingFindings,
    ...functionalityFindings,
    ...a11yFindings,
  ]);

  const annotated = await annotateScreenshot(target.screenshot, allFindings);

  return {
    findings: allFindings,
    diffImage: visualResult.diffImage,
    annotatedScreenshot: annotated,
  };
}
