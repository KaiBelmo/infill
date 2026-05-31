type SupportedControl =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | HTMLElement;

export type { SupportedControl };

export function querySelectorAllDeep(selector: string, root: Document | ShadowRoot | Element): SupportedControl[] {
  const results: SupportedControl[] = [];

  const rootNode = root instanceof Element ? root.shadowRoot ?? root : root;
  if ("querySelectorAll" in rootNode) {
    results.push(...Array.from(rootNode.querySelectorAll<SupportedControl>(selector)));
  }

  const allChildren = "querySelectorAll" in rootNode
    ? Array.from(rootNode.querySelectorAll<HTMLElement>("*"))
    : [];

  for (const child of allChildren) {
    if (child.shadowRoot) {
      results.push(...querySelectorAllDeep(selector, child.shadowRoot));
    }
  }

  return results;
}

export function isLikelyTokenField(element: HTMLElement): boolean {
  const text = [
    element.getAttribute("name"),
    element.id,
    element.getAttribute("autocomplete")
  ]
    .filter(Boolean)
    .join(" ");

  return /\b(csrf|token|nonce|captcha)\b/i.test(text);
}

export function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function isRequired(element: SupportedControl): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.required;
  }

  return element.getAttribute("aria-required") === "true";
}

export function isDisabled(element: SupportedControl): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.disabled;
  }

  return element.getAttribute("aria-disabled") === "true";
}

export function isReadonly(element: SupportedControl): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.readOnly;
  }

  return element.getAttribute("aria-readonly") === "true";
}

export function hasSensitiveType(inputType: string | undefined): boolean {
  return inputType === "password";
}

export function getMaxLength(element: SupportedControl): number | undefined {
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    element.maxLength > -1
  ) {
    return element.maxLength;
  }

  return undefined;
}

export function trimText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getControlValue(element: SupportedControl): string {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.value;
  }

  return element.textContent?.trim() ?? "";
}

export function buildCssPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && current !== document.documentElement) {
    const node: Element = current;
    const tagName = node.tagName.toLowerCase();
    const id = node.id ? `#${CSS.escape(node.id)}` : "";

    if (id) {
      segments.unshift(`${tagName}${id}`);
      break;
    }

    const parent: Element | null = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === node.tagName);
      const index = siblings.indexOf(node);
      const nth = siblings.length > 1 ? `:nth-of-type(${index + 1})` : "";
      segments.unshift(`${tagName}${nth}`);
    } else {
      segments.unshift(tagName);
    }

    current = parent;
  }

  return segments.join(" > ");
}

export function getDomPathHint(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const fmUid = element.getAttribute("data-fm-uid");
  const id = element.id ? `#${CSS.escape(element.id)}` : "";
  const name = element.getAttribute("name") ? `[name="${CSS.escape(element.getAttribute("name") ?? "")}"]` : "";
  const uid = fmUid ? `[data-fm-uid="${fmUid}"]` : "";

  return `${tagName}${id}${name}${uid}`;
}
