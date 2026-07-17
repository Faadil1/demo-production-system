import type { ValidationResult } from "./types.js";

export type BrowserSelector =
  | { readonly strategy: "test-id"; readonly value: string }
  | { readonly strategy: "role"; readonly role: string; readonly name?: string }
  | { readonly strategy: "label"; readonly value: string }
  | { readonly strategy: "text"; readonly value: string; readonly exact?: boolean }
  | { readonly strategy: "css"; readonly value: string };

/**
 * Selector preference policy (most to least preferred): test-id, accessible role/name,
 * label, exact visible text, CSS as a last resort. XPath is intentionally unsupported.
 */
export function validateSelector(selector: BrowserSelector, path: string): ValidationResult {
  switch (selector.strategy) {
    case "test-id":
      return selector.value.trim()
        ? { ok: true }
        : { ok: false, issues: [{ path: `${path}/value`, code: "empty-selector", message: "test-id selector value must not be empty." }] };
    case "role":
      return selector.role.trim()
        ? { ok: true }
        : { ok: false, issues: [{ path: `${path}/role`, code: "empty-selector", message: "role selector must not be empty." }] };
    case "label":
      return selector.value.trim()
        ? { ok: true }
        : { ok: false, issues: [{ path: `${path}/value`, code: "empty-selector", message: "label selector value must not be empty." }] };
    case "text":
      return selector.value.trim()
        ? { ok: true }
        : { ok: false, issues: [{ path: `${path}/value`, code: "empty-selector", message: "text selector value must not be empty." }] };
    case "css":
      return selector.value.trim()
        ? { ok: true }
        : { ok: false, issues: [{ path: `${path}/value`, code: "empty-selector", message: "css selector value must not be empty." }] };
    default:
      return {
        ok: false,
        issues: [{ path, code: "unsupported-strategy", message: `Unsupported selector strategy "${(selector as { strategy: string }).strategy}".` }],
      };
  }
}

export function describeSelector(selector: BrowserSelector): string {
  switch (selector.strategy) {
    case "test-id":
      return `test-id="${selector.value}"`;
    case "role":
      return selector.name ? `role=${selector.role}[name="${selector.name}"]` : `role=${selector.role}`;
    case "label":
      return `label="${selector.value}"`;
    case "text":
      return `text="${selector.value}"${selector.exact ? " (exact)" : ""}`;
    case "css":
      return `css="${selector.value}"`;
  }
}
