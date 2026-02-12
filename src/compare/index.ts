import type { PageCapture, RawFinding } from "../types/index.js";
import { compareVisual } from "./visual.js";
import { compareUntranslated } from "./untranslated.js";
import { compareLayout } from "./layout.js";
import { compareMissing } from "./missing.js";
import { compareFunctionality } from "./functionality.js";
import { compareAccessibility } from "./accessibility.js";

export interface CompareResult {
  findings: RawFinding[];
  diffImage: Buffer;
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

  return {
    findings: [
      ...untranslatedFindings,
      ...layoutFindings,
      ...missingFindings,
      ...functionalityFindings,
      ...a11yFindings,
    ],
    diffImage: visualResult.diffImage,
  };
}
