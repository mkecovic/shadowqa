import type { DOMNode } from "../types/index.js";

export interface FlatNode {
  tag: string;
  selector: string;
  attributes: Record<string, string>;
  textContent: string;
  directText: string;
  visible: boolean;
  boundingBox: DOMNode["boundingBox"];
  isClipped: boolean;
}

export function flattenDOM(nodes: DOMNode[]): FlatNode[] {
  const result: FlatNode[] = [];

  function walk(node: DOMNode) {
    result.push({
      tag: node.tag,
      selector: node.selector,
      attributes: node.attributes,
      textContent: node.textContent,
      directText: node.directText,
      visible: node.visible,
      boundingBox: node.boundingBox,
      isClipped: node.isClipped,
    });
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const node of nodes) {
    walk(node);
  }
  return result;
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

/**
 * Finds a matching node in targetNodes using stable cross-locale identifiers
 * when the exact CSS selector doesn't match (e.g. DOM restructuring on localized page).
 *
 * Tries in priority order:
 *   1. Same tag + same non-empty `id` attribute
 *   2. Same tag + same non-empty `name` attribute (form fields)
 *   3. Same tag + same non-empty `aria-label` attribute
 *
 * Text content is intentionally NOT used — translations change text, making it
 * an unreliable identifier across locales.
 *
 * Returns null if no confident match is found.
 */
export function findFuzzyMatch(source: FlatNode, targetNodes: FlatNode[]): FlatNode | null {
  const tag = source.tag.toLowerCase();
  const sourceId = source.attributes["id"]?.trim();
  const sourceName = source.attributes["name"]?.trim();
  const sourceAriaLabel = source.attributes["aria-label"]?.trim();

  for (const candidate of targetNodes) {
    if (candidate.tag.toLowerCase() !== tag) continue;
    if (!candidate.visible) continue;

    if (sourceId && candidate.attributes["id"]?.trim() === sourceId) return candidate;
    if (sourceName && candidate.attributes["name"]?.trim() === sourceName) return candidate;
    if (sourceAriaLabel && candidate.attributes["aria-label"]?.trim() === sourceAriaLabel) return candidate;
  }

  return null;
}
