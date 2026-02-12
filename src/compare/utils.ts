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

export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  let matches = 0;
  const shorterChars = shorter.split("");
  const longerChars = longer.split("");
  for (let i = 0; i < shorterChars.length; i++) {
    if (shorterChars[i] === longerChars[i]) matches++;
  }
  return matches / longer.length;
}
