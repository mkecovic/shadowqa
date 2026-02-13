import crypto from "crypto";
import type { Finding, RawFinding } from "../types/index.js";
import { scoreFinding } from "../scoring/index.js";

export function explainFindings(rawFindings: RawFinding[]): Finding[] {
  return rawFindings.map((raw) => {
    const { severity, confidence } = scoreFinding(raw);
    const impact = generateImpact(raw);
    const recommendation = generateRecommendation(raw);

    return {
      id: crypto.randomUUID(),
      category: raw.category,
      severity,
      confidence,
      title: raw.title,
      description: raw.description,
      impact,
      recommendation,
      element: raw.element,
      source: raw.source,
      target: raw.target,
      boundingBox: raw.boundingBox,
    };
  });
}

function generateImpact(raw: RawFinding): string {
  const meta = (raw.metadata || {}) as Record<string, any>;

  switch (raw.category) {
    case "bleeding":
      return generateUntranslatedImpact(raw, meta);
    case "formatting":
      return generateLayoutImpact(raw, meta);
    case "functional":
      return generateFunctionalImpact(raw, meta);
    case "source-issues":
      return generateSourceIssuesImpact(raw, meta);
    default:
      return "A localization issue was detected that may affect the user experience.";
  }
}

function generateUntranslatedImpact(
  raw: RawFinding,
  meta: Record<string, any>
): string {
  const scriptMismatch = meta.scriptMismatch as boolean | undefined;
  const isInteractive = meta.isInteractive as boolean | undefined;
  const isHeading = meta.isHeading as boolean | undefined;

  if (scriptMismatch) {
    return `Users reading the localized version will encounter text in the source language's script instead of the expected target script. This is a strong indicator that the string was never sent for translation.`;
  }

  if (isHeading) {
    return `A heading is displaying untranslated text. Users reading the localized version will see source-language text in a prominent position, breaking the reading experience and making the page appear incomplete.`;
  }

  if (isInteractive) {
    return `An interactive element (button, link, or form control) contains untranslated text. Users may not understand the action this element performs, which can block task completion.`;
  }

  return `Users reading the localized version will encounter untranslated source-language text. This breaks the localized experience and may confuse users who do not read the source language.`;
}

function generateLayoutImpact(
  raw: RawFinding,
  meta: Record<string, any>
): string {
  const type = meta.type as string | undefined;
  const tag = raw.element.tag.toLowerCase();
  const isInteractive = ["a", "button", "input", "select", "textarea"].includes(tag);

  if (type === "truncation") {
    if (isInteractive) {
      return `Translated text caused truncation in an interactive element. Users may not be able to read the full label of this control, making it unclear what action it performs.`;
    }
    return `Translated text is being clipped or truncated in this element. Users will see incomplete text, which may obscure important information.`;
  }

  if (type === "resize") {
    return `Translated text caused this element to grow significantly in size. This may push other content out of position or break the intended page layout.`;
  }

  if (type === "overflow") {
    return `Translated text is overflowing its container. This can cause text to overlap with other elements or extend beyond visible boundaries, making content unreadable.`;
  }

  if (type === "overlap") {
    return `Two elements are overlapping on the localized page that did not overlap on the source page. This likely resulted from text expansion after translation and makes one or both elements partially unreadable.`;
  }

  return `A layout issue was detected on the localized page, likely caused by differences in text length after translation.`;
}

function generateFunctionalImpact(
  raw: RawFinding,
  meta: Record<string, any>
): string {
  const type = meta.type as string | undefined;

  // Dispatch based on metadata.type
  if (type === "missing") {
    return generateMissingImpact(raw, meta);
  }
  if (type === "new-violation" || type === "regression" || type === "violation-spread") {
    return generateA11yImpact(raw, meta);
  }
  return generateFunctionalityImpact(raw, meta);
}

function generateMissingImpact(
  raw: RawFinding,
  meta: Record<string, any>
): string {
  const isInteractive = meta.isInteractive as boolean | undefined;
  const isLandmark = meta.isLandmark as boolean | undefined;
  const isHeading = meta.isHeading as boolean | undefined;

  if (isInteractive) {
    return `An interactive element present on the source page is missing from the localized version. Users of the localized page will not be able to perform the action this element provides, potentially blocking a workflow.`;
  }

  if (isLandmark) {
    return `A page landmark (navigation, header, footer, or content section) is missing from the localized version. This affects page structure and may break navigation for assistive technology users.`;
  }

  if (isHeading) {
    return `A heading is missing from the localized version. This affects the content hierarchy and may make it harder for users to scan and navigate the page.`;
  }

  return `An element present on the source page is missing from the localized version. Users of the localized page will not see this content.`;
}

function generateFunctionalityImpact(
  raw: RawFinding,
  meta: Record<string, any>
): string {
  const type = meta.type as string | undefined;

  if (type === "tag-downgrade") {
    return `An interactive element was downgraded to a non-interactive tag on the localized page. This removes native keyboard and screen reader support, breaking the element's functionality for many users.`;
  }

  if (type === "href-removed") {
    return `A link lost its destination on the localized page. Users will see what appears to be a link but clicking it will not navigate anywhere.`;
  }

  if (type === "href-not-localized") {
    return `A link on the localized page still points to the source domain instead of the localized domain. Users may be unexpectedly navigated away from the localized experience.`;
  }

  if (type === "href-changed") {
    return `A third-party link points to a different destination on the localized page than on the source page. This may be intentional (region-specific URL) or an error.`;
  }

  if (type === "state-change") {
    const attr = meta.attribute as string;
    if (attr === "disabled" || attr === "aria-disabled") {
      return `An element's enabled/disabled state changed on the localized page. Users may be unable to interact with an element that should be available, or vice versa.`;
    }
    if (attr === "readonly") {
      return `An element's read-only state changed on the localized page. Users may be unable to edit a field that should be editable.`;
    }
    return `An interactive element's state changed on the localized page, which may affect how users can interact with it.`;
  }

  if (type === "form-change") {
    return `A form's submission behavior changed on the localized page. This could cause form submissions to fail or be sent to the wrong endpoint.`;
  }

  if (type === "tabindex-change") {
    return `An element was removed from the keyboard tab order on the localized page. Keyboard-only users will not be able to reach this element.`;
  }

  return `An interactive element's behavior changed on the localized page, which may affect functionality for users.`;
}

function generateSourceIssuesImpact(
  raw: RawFinding,
  meta: Record<string, any>
): string {
  const impact = meta.impact as string | undefined;

  if (impact === "critical" || impact === "serious") {
    return `This is a pre-existing accessibility issue that affects both the source and target pages. While not caused by localization, it impacts users with disabilities on both versions of the site.`;
  }
  return `This accessibility issue exists on both the source and target pages. It is not a localization regression but a pre-existing issue worth noting.`;
}

function generateA11yImpact(
  raw: RawFinding,
  meta: Record<string, any>
): string {
  const impact = meta.impact as string | undefined;
  const type = meta.type as string | undefined;

  if (type === "regression") {
    return `Users who rely on assistive technology (screen readers, keyboard navigation) will be directly affected. This accessibility check was passing on the source page but is failing on the localized version, indicating a regression introduced by localization.`;
  }
  if (type === "new-violation") {
    if (impact === "critical") {
      return `This is a critical accessibility barrier introduced in the localized version. Users with disabilities may be completely unable to use the affected element.`;
    }
    if (impact === "serious") {
      return `This creates a significant accessibility barrier in the localized version. While the element may still be partially usable, it does not meet accessibility standards.`;
    }
    return `This accessibility issue was introduced in the localized version and may cause difficulty for users relying on assistive technology.`;
  }
  if (type === "violation-spread") {
    return `An existing accessibility issue now affects more elements in the localized version, widening the impact on users with disabilities.`;
  }
  return `Users relying on assistive technology may be affected by this accessibility change in the localized version.`;
}

function generateRecommendation(raw: RawFinding): string {
  const meta = (raw.metadata || {}) as Record<string, any>;

  switch (raw.category) {
    case "bleeding": {
      const scriptMismatch = meta.scriptMismatch as boolean | undefined;
      if (scriptMismatch) {
        return `This text appears to be in the wrong script for the target locale. Verify it was included in the translation package and re-translate if needed.`;
      }
      return `Verify whether this text was intentionally left untranslated (e.g., brand names, technical terms). If it should be translated, add it to the translation strings and request localization.`;
    }

    case "formatting": {
      const type = meta.type as string | undefined;
      if (type === "truncation") {
        return `The translated text is too long for its container. Consider increasing the container width, enabling text wrapping, or working with translators to use a shorter translation.`;
      }
      if (type === "resize") {
        return `The container grew significantly due to longer translated text. Review the layout to ensure it handles text expansion gracefully. Consider using flexible layouts or setting max-width constraints.`;
      }
      if (type === "overlap") {
        return `Elements are overlapping due to layout changes from translation. Adjust spacing, use flexible layouts, or review the translated text length.`;
      }
      return `Review the layout in the localized version and adjust CSS or container sizing to accommodate translated text.`;
    }

    case "functional": {
      const type = meta.type as string | undefined;

      // Missing element findings
      if (type === "missing") {
        return `Verify this element was not accidentally removed during localization. Check the localized page template or code for missing markup. If the element is intentionally different, document the reason.`;
      }

      // Accessibility findings (non-pre-existing)
      if (type === "new-violation" || type === "regression" || type === "violation-spread") {
        const helpUrl = meta.helpUrl as string | undefined;
        const failureSummary = meta.failureSummary as string | undefined;
        let rec = "Review the accessibility violation introduced in the localized version and fix it to ensure all users can access this content.";
        if (failureSummary) {
          rec += ` Failure details: ${failureSummary}`;
        }
        if (helpUrl) {
          rec += ` Learn more: ${helpUrl}`;
        }
        return rec;
      }

      // Functionality findings
      if (type === "tag-downgrade") {
        return `Restore the original interactive tag or add appropriate ARIA roles to maintain accessibility and functionality.`;
      }
      if (type === "href-removed") {
        return `Verify the link destination is correct for the localized version. If the href was accidentally removed, restore it.`;
      }
      if (type === "href-not-localized") {
        return `Update this link to point to the localized version of the destination page, so users stay within the localized experience.`;
      }
      if (type === "href-changed") {
        return `Verify this third-party link change is intentional. If it should point to the same destination as the source page, restore the original URL.`;
      }
      return `Review the interactive element on the localized page and verify its behavior matches the source page.`;
    }

    case "source-issues": {
      const helpUrl = meta.helpUrl as string | undefined;
      let rec = "This is a pre-existing issue, not caused by localization. Consider fixing it on the source page — it will then be resolved on all localized versions.";
      if (helpUrl) {
        rec += ` Learn more: ${helpUrl}`;
      }
      return rec;
    }

    default:
      return `Review this finding and verify the localized page matches the expected behavior.`;
  }
}
