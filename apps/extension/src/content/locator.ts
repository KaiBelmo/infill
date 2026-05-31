import type { ExtractedField } from "@infill/shared";
import { querySelectorAllDeep } from "./scanner/dom-utils";

export type LocateResult =
  | { element: Element; strategy: string }
  | { element: null; strategy: null; reason: string };

/**
 * Multi-strategy element locator that cascades through increasingly
 * lenient selectors so a page re-render between scan and fill doesn't
 * cause silent failures.
 *
 * 1. domPathHint  — original data-fm-uid selector (fast, exact)
 * 2. cssPath      — structural nth-child path (survives re-renders)
 * 3. id + tagName  — e.g. input#email
 * 4. name + tagName — e.g. input[name="email"]
 * 5. label text    — find label whose text matches, then resolve its `for` target
 */
export function locateField(field: ExtractedField): LocateResult {
  // 1. domPathHint (original strategy)
  if (field.domPathHint) {
    const el = findElementDeep(field.domPathHint);
    if (el) return { element: el, strategy: "domPathHint" };
  }

  // 2. cssPath (structural path — survives SPA re-renders)
  if (field.cssPath) {
    const el = findElementDeep(field.cssPath);
    if (el) return { element: el, strategy: "cssPath" };
  }

  // 3. id + tagName
  if (field.id && field.tagName) {
    const selector = `${field.tagName}#${CSS.escape(field.id)}`;
    const el = findElementDeep(selector);
    if (el) return { element: el, strategy: "id" };
  }

  // 4. name + tagName
  if (field.name && field.tagName) {
    const selector = `${field.tagName}[name="${CSS.escape(field.name)}"]`;
    const el = findElementDeep(selector);
    if (el) return { element: el, strategy: "name" };
  }

  // 5. label text → for attribute → target element
  if (field.labelText && field.tagName) {
    const labels = Array.from(document.getElementsByTagName("label"));
    const matchingLabel = labels.find(
      (label) => label.textContent?.trim() === field.labelText
    );
    const forAttr = matchingLabel?.getAttribute("for");
    if (forAttr) {
      const el = findElementDeep(`${field.tagName}#${CSS.escape(forAttr)}`);
      if (el) return { element: el, strategy: "labelText" };
    }
  }

  return {
    element: null,
    strategy: null,
    reason: `Could not locate field "${field.labelText ?? field.name ?? field.fieldId}" — page may have re-rendered since scan. Try re-scanning.`
  };
}

/**
 * querySelector that traverses open shadow roots.
 * Delegates to querySelectorAllDeep and returns the first match.
 */
export function findElementDeep(selector: string, root: Document | ShadowRoot | Element = document): Element | null {
  return querySelectorAllDeep(selector, root)[0] ?? null;
}
