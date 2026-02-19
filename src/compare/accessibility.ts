import type { PageCapture, RawFinding, AxeViolation, DOMNode, BoundingBox } from "../types/index.js";

export function compareAccessibility(
  source: PageCapture,
  target: PageCapture
): RawFinding[] {
  const findings: RawFinding[] = [];

  const sourceViolationMap = indexViolations(source.accessibility.violations);
  const targetViolationMap = indexViolations(target.accessibility.violations);
  const targetBBoxIndex = buildBoundingBoxIndex(target.dom);

  // New violations in target that weren't in source — regressions introduced by localization
  for (const [key, targetViolation] of targetViolationMap) {
    if (!sourceViolationMap.has(key)) {
      for (const node of targetViolation.nodes) {
        const selector = node.target.join(" ");
        findings.push({
          category: "functional",
          title: `New a11y violation: ${targetViolation.help}`,
          description: `${targetViolation.description}. This issue was introduced in the localized version.`,
          element: {
            selector,
            tag: extractTagFromHtml(node.html),
          },
          source: "No violation",
          target: `${targetViolation.impact}: ${targetViolation.help}`,
          boundingBox: targetBBoxIndex.get(selector),
          metadata: {
            type: "new-violation",
            ruleId: targetViolation.id,
            impact: targetViolation.impact,
            helpUrl: targetViolation.helpUrl,
            failureSummary: node.failureSummary,
          },
        });
      }
    }
  }

  // Violations that got worse (more affected nodes)
  for (const [key, targetViolation] of targetViolationMap) {
    const sourceViolation = sourceViolationMap.get(key);
    if (
      sourceViolation &&
      targetViolation.nodes.length > sourceViolation.nodes.length
    ) {
      const newNodeCount =
        targetViolation.nodes.length - sourceViolation.nodes.length;
      const firstSelector = targetViolation.nodes[0]?.target.join(" ") || "unknown";
      findings.push({
        category: "functional",
        title: `A11y violation spread: ${targetViolation.help}`,
        description: `The "${targetViolation.id}" violation now affects ${targetViolation.nodes.length} elements (was ${sourceViolation.nodes.length}). ${newNodeCount} new element(s) affected in the localized version.`,
        element: {
          selector: firstSelector,
          tag: extractTagFromHtml(targetViolation.nodes[0]?.html || ""),
        },
        source: `${sourceViolation.nodes.length} element(s) affected`,
        target: `${targetViolation.nodes.length} element(s) affected`,
        boundingBox: targetBBoxIndex.get(firstSelector),
        metadata: {
          type: "violation-spread",
          ruleId: targetViolation.id,
          impact: targetViolation.impact,
        },
      });
    }
  }

  // Check for regressions in passes → violations
  // Only if the rule was NOT already violating on source (avoids false regressions
  // when a rule both passes and violates on different elements)
  const sourcePassIds = new Set(
    source.accessibility.passes.map((p) => p.id)
  );
  for (const targetViolation of target.accessibility.violations) {
    if (sourcePassIds.has(targetViolation.id) && !sourceViolationMap.has(targetViolation.id)) {
      for (const node of targetViolation.nodes) {
        const selector = node.target.join(" ");
        const alreadyReported = findings.some(
          (f) =>
            f.element.selector === selector &&
            (f.metadata as any)?.ruleId === targetViolation.id
        );
        if (!alreadyReported) {
          findings.push({
            category: "functional",
            title: `A11y regression: ${targetViolation.help}`,
            description: `Rule "${targetViolation.id}" was passing on the source page but is failing on the localized version. ${targetViolation.description}`,
            element: {
              selector,
              tag: extractTagFromHtml(node.html),
            },
            source: "Rule passing",
            target: `${targetViolation.impact}: ${targetViolation.help}`,
            boundingBox: targetBBoxIndex.get(selector),
            metadata: {
              type: "regression",
              ruleId: targetViolation.id,
              impact: targetViolation.impact,
              helpUrl: targetViolation.helpUrl,
              failureSummary: node.failureSummary,
            },
          });
        }
      }
    }
  }

  // Pre-existing violations — present on both source and target (not caused by localization)
  for (const [key, targetViolation] of targetViolationMap) {
    const sourceViolation = sourceViolationMap.get(key);
    if (!sourceViolation) continue;

    // Already reported as "violation-spread" if node count grew
    if (targetViolation.nodes.length > sourceViolation.nodes.length) continue;

    // Same rule, same or fewer nodes — this is a pre-existing issue
    const preExistingSelector = targetViolation.nodes[0]?.target.join(" ") || "unknown";
    findings.push({
      category: "source-issues",
      title: `Pre-existing a11y issue: ${targetViolation.help}`,
      description: `${targetViolation.description}. This issue exists on both the source and target pages — it is not caused by localization.`,
      element: {
        selector: preExistingSelector,
        tag: extractTagFromHtml(targetViolation.nodes[0]?.html || ""),
      },
      source: `${targetViolation.impact}: ${sourceViolation.nodes.length} element(s)`,
      target: `${targetViolation.impact}: ${targetViolation.nodes.length} element(s)`,
      boundingBox: targetBBoxIndex.get(preExistingSelector),
      metadata: {
        type: "pre-existing",
        ruleId: targetViolation.id,
        impact: targetViolation.impact,
        helpUrl: targetViolation.helpUrl,
      },
    });
  }

  return findings;
}

function indexViolations(
  violations: AxeViolation[]
): Map<string, AxeViolation> {
  const map = new Map<string, AxeViolation>();
  for (const v of violations) {
    map.set(v.id, v);
  }
  return map;
}

function buildBoundingBoxIndex(nodes: DOMNode[]): Map<string, BoundingBox> {
  const map = new Map<string, BoundingBox>();
  const walk = (node: DOMNode) => {
    if (node.boundingBox && node.selector) {
      map.set(node.selector, node.boundingBox);
    }
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  return map;
}

function extractTagFromHtml(html: string): string {
  const match = html.match(/^<(\w+)/);
  return match ? match[1] : "unknown";
}
