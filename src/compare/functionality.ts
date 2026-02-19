import type { PageCapture, RawFinding } from "../types/index.js";
import { flattenDOM, truncate } from "./utils.js";

const INTERACTIVE_TAGS = new Set([
  "a", "button", "input", "select", "textarea", "form", "details", "summary",
]);

export function compareFunctionality(
  source: PageCapture,
  target: PageCapture
): RawFinding[] {
  const sourcePageDomain = getDomain(source.url);
  const sourceNodes = flattenDOM(source.dom);
  const targetNodes = flattenDOM(target.dom);

  const sourceMap = new Map(sourceNodes.map((n) => [n.selector, n]));
  const targetMap = new Map(targetNodes.map((n) => [n.selector, n]));

  const findings: RawFinding[] = [];

  for (const [selector, sourceNode] of sourceMap) {
    const targetNode = targetMap.get(selector);
    if (!targetNode) continue;

    // Tag downgrade (e.g. button → div, a → span)
    if (sourceNode.tag !== targetNode.tag) {
      const sourceIsInteractive = INTERACTIVE_TAGS.has(sourceNode.tag.toLowerCase());
      const targetIsInteractive = INTERACTIVE_TAGS.has(targetNode.tag.toLowerCase());

      if (sourceIsInteractive && !targetIsInteractive) {
        findings.push({
          category: "functional",
          title: `Tag downgrade: <${sourceNode.tag}> → <${targetNode.tag}>`,
          description: `Interactive element at "${selector}" was downgraded from <${sourceNode.tag}> to <${targetNode.tag}> on the localized page`,
          element: { selector, tag: targetNode.tag },
          source: `<${sourceNode.tag}>`,
          target: `<${targetNode.tag}>`,
          boundingBox: targetNode.boundingBox ?? undefined,
          metadata: { type: "tag-downgrade" },
        });
      }
    }

    // href checks on links
    if (sourceNode.tag.toLowerCase() === "a" && targetNode.tag.toLowerCase() === "a") {
      const sourceHref = sourceNode.attributes["href"] || "";
      const targetHref = targetNode.attributes["href"] || "";

      if (sourceHref && !targetHref) {
        findings.push({
          category: "functional",
          title: `Link href removed on <a>`,
          description: `The link at "${selector}" lost its href attribute on the localized page`,
          element: { selector, tag: "a" },
          source: `href="${sourceHref}"`,
          target: "(href removed)",
          boundingBox: targetNode.boundingBox ?? undefined,
          metadata: { type: "href-removed" },
        });
      } else if (sourceHref && targetHref) {
        const linkDomain = getDomain(sourceHref);

        if (linkDomain && linkDomain === sourcePageDomain && sourceHref === targetHref) {
          // Only flag if the link's visible text was translated — this distinguishes
          // a localized CTA (text changed, URL forgotten) from shared nav/footer links
          // (text same, URL expected to stay the same). Flagging every unchanged nav
          // link produces massive noise with near-zero signal.
          const srcText = sourceNode.textContent.trim();
          const tgtText = targetNode.textContent.trim();
          const textWasTranslated = srcText.length > 0 && tgtText.length > 0 && srcText !== tgtText;
          if (!textWasTranslated) continue;

          findings.push({
            category: "functional",
            title: `Link not localized on <a>`,
            description: `The link at "${selector}" still points to the source domain (${sourcePageDomain}) on the localized page, but its label was translated from "${truncate(srcText, 40)}" to "${truncate(tgtText, 40)}"`,
            element: { selector, tag: "a" },
            source: `href="${sourceHref}"`,
            target: `href="${targetHref}" (unchanged)`,
            boundingBox: targetNode.boundingBox ?? undefined,
            metadata: { type: "href-not-localized" },
          });
        } else if (linkDomain && linkDomain !== sourcePageDomain && sourceHref !== targetHref) {
          // Third-party link changed — unexpected
          findings.push({
            category: "functional",
            title: `Third-party link changed on <a>`,
            description: `The external link at "${selector}" points to a different destination on the localized page`,
            element: { selector, tag: "a" },
            source: `href="${sourceHref}"`,
            target: `href="${targetHref}"`,
            boundingBox: targetNode.boundingBox ?? undefined,
            metadata: { type: "href-changed" },
          });
        }
      }
    }

    // disabled / readonly state changes
    const disabledAttrs = ["disabled", "readonly", "aria-disabled"];
    for (const attr of disabledAttrs) {
      const sourceVal = sourceNode.attributes[attr];
      const targetVal = targetNode.attributes[attr];

      if (sourceVal === undefined && targetVal !== undefined) {
        findings.push({
          category: "functional",
          title: `Element became ${attr}: <${targetNode.tag}>`,
          description: `The element at "${selector}" gained "${attr}" attribute on the localized page`,
          element: { selector, tag: targetNode.tag },
          source: `(no ${attr})`,
          target: `${attr}="${targetVal}"`,
          boundingBox: targetNode.boundingBox ?? undefined,
          metadata: { type: "state-change", attribute: attr },
        });
      } else if (sourceVal !== undefined && targetVal === undefined && attr !== "aria-disabled") {
        // disabled removed is less concerning, but note it
        findings.push({
          category: "functional",
          title: `${attr} removed: <${targetNode.tag}>`,
          description: `The element at "${selector}" lost "${attr}" attribute on the localized page`,
          element: { selector, tag: targetNode.tag },
          source: `${attr}="${sourceVal}"`,
          target: `(${attr} removed)`,
          boundingBox: targetNode.boundingBox ?? undefined,
          metadata: { type: "state-change", attribute: attr },
        });
      }
    }

    // Form action/method changes
    if (sourceNode.tag.toLowerCase() === "form" && targetNode.tag.toLowerCase() === "form") {
      const sourceAction = sourceNode.attributes["action"] || "";
      const targetAction = targetNode.attributes["action"] || "";
      const sourceMethod = sourceNode.attributes["method"] || "";
      const targetMethod = targetNode.attributes["method"] || "";

      if (sourceAction && sourceAction !== targetAction) {
        findings.push({
          category: "functional",
          title: `Form action changed`,
          description: `The form at "${selector}" has a different action on the localized page`,
          element: { selector, tag: "form" },
          source: `action="${sourceAction}"`,
          target: targetAction ? `action="${targetAction}"` : "(action removed)",
          boundingBox: targetNode.boundingBox ?? undefined,
          metadata: { type: "form-change", attribute: "action" },
        });
      }

      if (sourceMethod && sourceMethod !== targetMethod) {
        findings.push({
          category: "functional",
          title: `Form method changed`,
          description: `The form at "${selector}" has a different method on the localized page`,
          element: { selector, tag: "form" },
          source: `method="${sourceMethod}"`,
          target: targetMethod ? `method="${targetMethod}"` : "(method removed)",
          boundingBox: targetNode.boundingBox ?? undefined,
          metadata: { type: "form-change", attribute: "method" },
        });
      }
    }

    // tabindex changes
    const sourceTabindex = sourceNode.attributes["tabindex"];
    const targetTabindex = targetNode.attributes["tabindex"];
    if (sourceTabindex !== targetTabindex) {
      if (sourceTabindex !== undefined && targetTabindex === undefined) {
        // tabindex removed
      } else if (sourceTabindex === undefined && targetTabindex === "-1") {
        // Element made unfocusable on target
        findings.push({
          category: "functional",
          title: `Element made unfocusable: <${targetNode.tag}>`,
          description: `The element at "${selector}" was given tabindex="-1" on the localized page, removing it from tab order`,
          element: { selector, tag: targetNode.tag },
          source: "(no tabindex)",
          target: 'tabindex="-1"',
          boundingBox: targetNode.boundingBox ?? undefined,
          metadata: { type: "tabindex-change" },
        });
      }
    }
  }

  return findings;
}

/**
 * Extract domain from an href. Returns null for relative URLs.
 */
function getDomain(href: string): string | null {
  try {
    const url = new URL(href);
    return url.hostname;
  } catch {
    return null; // relative URL
  }
}
