export type DomSanitizationResult = {
  readonly sanitizedHtml: string;
  readonly scriptsRemoved: number;
  readonly sensitiveFieldsRedacted: number;
  readonly commentsRemoved: number;
};

/**
 * Deterministic, dependency-free HTML sanitizer for DOM snapshot evidence. This is a
 * pragmatic regex-based pass, not a full HTML parser — it is intentionally
 * conservative (better to over-remove than to leak something sensitive).
 *
 * Removed and counted:
 *   - scriptsRemoved: <script>, <style>, and <iframe> blocks (including their content).
 *   - sensitiveFieldsRedacted: input `value` attributes, <textarea> contents, entire
 *     hidden `<input type="hidden">` elements, and <meta> tags whose name/content
 *     looks like a token/csrf value.
 *   - commentsRemoved: HTML comments.
 *
 * Always stripped but not separately counted (documented in docs/006): inline
 * event-handler attributes (onclick, onload, ...), and `nonce`/`integrity` attributes
 * (security-sensitive and non-deterministic across runs).
 *
 * Local/session storage content is never included in the first place — it is never
 * read by the DOM snapshot capture path, so there is nothing to strip here.
 */
export function sanitizeDomSnapshot(html: string): DomSanitizationResult {
  let scriptsRemoved = 0;
  let sensitiveFieldsRedacted = 0;
  let commentsRemoved = 0;

  let sanitized = html;

  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, () => {
    commentsRemoved += 1;
    return "";
  });

  sanitized = sanitized.replace(/<script[\s\S]*?<\/script\s*>/gi, () => {
    scriptsRemoved += 1;
    return "";
  });
  sanitized = sanitized.replace(/<style[\s\S]*?<\/style\s*>/gi, () => {
    scriptsRemoved += 1;
    return "";
  });
  sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, () => {
    scriptsRemoved += 1;
    return "<!-- iframe removed -->".replace("<!--", "").replace("-->", "");
  });
  // Self-closing / no-content iframes.
  sanitized = sanitized.replace(/<iframe\b[^>]*\/?>(?!.*<\/iframe>)/gi, () => {
    scriptsRemoved += 1;
    return "";
  });

  sanitized = sanitized.replace(/<textarea\b([^>]*)>[\s\S]*?<\/textarea\s*>/gi, (_match, attrs: string) => {
    sensitiveFieldsRedacted += 1;
    return `<textarea${attrs}></textarea>`;
  });

  sanitized = sanitized.replace(/<input\b[^>]*\btype=["']?hidden["']?[^>]*>/gi, () => {
    sensitiveFieldsRedacted += 1;
    return "";
  });

  sanitized = sanitized.replace(/(<input\b[^>]*?)\svalue=(".*?"|'.*?'|[^\s>]+)/gi, (_match, prefix: string) => {
    sensitiveFieldsRedacted += 1;
    return prefix;
  });

  sanitized = sanitized.replace(/<meta\b[^>]*\b(?:name|content)=["'][^"']*(?:token|csrf|secret)[^"']*["'][^>]*>/gi, () => {
    sensitiveFieldsRedacted += 1;
    return "";
  });

  sanitized = sanitized.replace(/\son\w+=(".*?"|'.*?')/gi, "");
  sanitized = sanitized.replace(/\s(nonce|integrity)=(".*?"|'.*?')/gi, "");

  return { sanitizedHtml: sanitized, scriptsRemoved, sensitiveFieldsRedacted, commentsRemoved };
}
