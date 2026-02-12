import type { PageCapture, RawFinding } from "../types/index.js";
import { flattenDOM, truncate } from "./utils.js";

const INTERACTIVE_TAGS = new Set([
  "a", "button", "input", "select", "textarea", "form", "details", "summary",
]);

const LANDMARK_TAGS = new Set([
  "nav", "main", "header", "footer", "aside", "section", "article",
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function compareMissing(
  source: PageCapture,
  target: PageCapture
): RawFinding[] {
  const sourceNodes = flattenDOM(source.dom);
  const targetNodes = flattenDOM(target.dom);

  const sourceMap = new Map(sourceNodes.map((n) => [n.selector, n]));
  const targetMap = new Map(targetNodes.map((n) => [n.selector, n]));

  const findings: RawFinding[] = [];

  // Elements on source that are missing from target
  for (const [selector, node] of sourceMap) {
    if (!node.visible) continue;
    if (targetMap.has(selector)) continue;

    const tag = node.tag.toLowerCase();
    const isInteractive = INTERACTIVE_TAGS.has(tag);
    const isLandmark = LANDMARK_TAGS.has(tag);
    const isHeading = HEADING_TAGS.has(tag);

    // Only report meaningful elements (interactive, landmarks, headings, or elements with content)
    if (!isInteractive && !isLandmark && !isHeading && !node.textContent) continue;

    findings.push({
      category: "missing",
      title: `Missing element: <${node.tag}>${node.textContent ? ` "${truncate(node.textContent, 40)}"` : ""}`,
      description: `The <${node.tag}> element at "${selector}" is present on the source page but missing from the localized version`,
      element: { selector, tag: node.tag },
      source: `<${node.tag}> present${node.textContent ? ` ("${truncate(node.textContent, 80)}")` : ""}`,
      target: "Element not found",
      metadata: {
        type: "missing",
        isInteractive,
        isLandmark,
        isHeading,
        hasContent: node.textContent.length > 0,
      },
    });
  }

  return findings;
}
