import type { PageCapture, RawFinding, BoundingBox } from "../types/index.js";
import { flattenDOM, type FlatNode } from "./utils.js";

export function compareLayout(
  source: PageCapture,
  target: PageCapture
): RawFinding[] {
  const sourceNodes = flattenDOM(source.dom);
  const targetNodes = flattenDOM(target.dom);

  const sourceMap = new Map(sourceNodes.map((n) => [n.selector, n]));
  const targetMap = new Map(targetNodes.map((n) => [n.selector, n]));

  const findings: RawFinding[] = [];

  for (const [selector, sourceNode] of sourceMap) {
    const targetNode = targetMap.get(selector);
    if (!targetNode) continue;
    if (!sourceNode.visible || !targetNode.visible) continue;
    if (!sourceNode.boundingBox || !targetNode.boundingBox) continue;

    // Detect truncation: not clipped on source, clipped on target
    if (!sourceNode.isClipped && targetNode.isClipped) {
      findings.push({
        category: "layout",
        title: `Text truncation in <${targetNode.tag}>`,
        description: `The element at "${selector}" is clipped/truncated on the target page but not on the source`,
        element: { selector, tag: targetNode.tag },
        source: `${sourceNode.boundingBox.width}x${sourceNode.boundingBox.height}px, not clipped`,
        target: `${targetNode.boundingBox.width}x${targetNode.boundingBox.height}px, clipped`,
        metadata: {
          type: "truncation",
          sourceBounds: sourceNode.boundingBox,
          targetBounds: targetNode.boundingBox,
        },
      });
    }

    // Detect significant height growth (>50% — text expansion)
    const heightGrowth =
      (targetNode.boundingBox.height - sourceNode.boundingBox.height) /
      sourceNode.boundingBox.height;
    if (heightGrowth > 0.5 && sourceNode.boundingBox.height > 10) {
      findings.push({
        category: "layout",
        title: `Significant resize in <${targetNode.tag}>`,
        description: `The element at "${selector}" grew ${Math.round(heightGrowth * 100)}% taller on the target page, likely due to text expansion`,
        element: { selector, tag: targetNode.tag },
        source: `${sourceNode.boundingBox.width}x${sourceNode.boundingBox.height}px`,
        target: `${targetNode.boundingBox.width}x${targetNode.boundingBox.height}px`,
        metadata: {
          type: "resize",
          heightGrowth,
          sourceBounds: sourceNode.boundingBox,
          targetBounds: targetNode.boundingBox,
          aboveFold: targetNode.boundingBox.y < target.viewport.height,
        },
      });
    }
  }

  // Detect sibling overlap on target that doesn't exist on source
  const overlapFindings = detectNewOverlaps(sourceNodes, targetNodes, sourceMap, targetMap);
  findings.push(...overlapFindings);

  return findings;
}

function detectNewOverlaps(
  sourceNodes: FlatNode[],
  targetNodes: FlatNode[],
  sourceMap: Map<string, FlatNode>,
  targetMap: Map<string, FlatNode>
): RawFinding[] {
  const findings: RawFinding[] = [];
  const reported = new Set<string>();

  // Only check visible leaf-ish elements (elements with bounding boxes)
  const targetVisible = targetNodes.filter(
    (n) => n.visible && n.boundingBox && n.boundingBox.width > 0
  );

  for (let i = 0; i < targetVisible.length; i++) {
    for (let j = i + 1; j < targetVisible.length; j++) {
      const a = targetVisible[i];
      const b = targetVisible[j];

      // Only check if they share a parent path (siblings or close cousins)
      if (!areSiblingish(a.selector, b.selector)) continue;

      const targetOverlap = getOverlapArea(a.boundingBox!, b.boundingBox!);
      if (targetOverlap <= 0) continue;

      // Check if this overlap also existed on source
      const sourceA = sourceMap.get(a.selector);
      const sourceB = sourceMap.get(b.selector);
      if (sourceA?.boundingBox && sourceB?.boundingBox) {
        const sourceOverlap = getOverlapArea(
          sourceA.boundingBox,
          sourceB.boundingBox
        );
        if (sourceOverlap > 0) continue; // overlap already existed
      }

      const key = [a.selector, b.selector].sort().join("|");
      if (reported.has(key)) continue;
      reported.add(key);

      findings.push({
        category: "layout",
        title: `Elements overlap: <${a.tag}> and <${b.tag}>`,
        description: `"${a.selector}" and "${b.selector}" overlap on the target page but not on the source`,
        element: { selector: a.selector, tag: a.tag },
        source: "No overlap",
        target: `${targetOverlap}px² overlap area`,
        metadata: {
          type: "overlap",
          overlapArea: targetOverlap,
        },
      });
    }
  }

  return findings;
}

function areSiblingish(selectorA: string, selectorB: string): boolean {
  const partsA = selectorA.split(" > ");
  const partsB = selectorB.split(" > ");
  // Share at least the first 2 segments (roughly same parent area)
  if (partsA.length < 2 || partsB.length < 2) return false;
  return partsA.slice(0, -1).join(" > ") === partsB.slice(0, -1).join(" > ");
}

function getOverlapArea(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}
