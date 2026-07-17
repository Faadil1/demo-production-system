import type { BrowserResourceType } from "./browser-capture-policy.js";

export type BrowserOriginRelationship = "first-party" | "third-party" | "unknown";
export type BrowserNetworkDecision = "allowed" | "blocked";

export type BrowserNetworkRecord = {
  readonly id: string;
  /** Always sanitized via sanitizeUrl() before being stored — never raw. */
  readonly url: string;
  readonly method: string;
  readonly resourceType: BrowserResourceType;
  readonly originRelationship: BrowserOriginRelationship;
  readonly decision: BrowserNetworkDecision;
  readonly statusCode: number | null;
  readonly failureReason: string | null;
  readonly timingMs: number | null;
};

/**
 * Configurable, documented list of query-parameter names treated as sensitive and
 * redacted from any persisted URL. Never persisted regardless of this list: request
 * bodies, form bodies, Authorization/Cookie/Set-Cookie headers, and storage contents —
 * those are simply never captured at all (see ffprobe/playwright adapter code).
 */
export const DEFAULT_SENSITIVE_QUERY_PARAM_NAMES: readonly string[] = [
  "token",
  "access_token",
  "api_key",
  "key",
  "secret",
  "password",
  "code",
  "session",
  "auth",
];

const REDACTED = "[redacted]";

/** Strips embedded credentials and redacts sensitive query parameters from a URL. */
export function sanitizeUrl(url: string, extraSensitiveParamNames: readonly string[] = []): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const sensitiveNames = new Set(
    [...DEFAULT_SENSITIVE_QUERY_PARAM_NAMES, ...extraSensitiveParamNames].map((name) => name.toLowerCase()),
  );
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (sensitiveNames.has(key.toLowerCase())) {
      parsed.searchParams.set(key, REDACTED);
    }
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

export function classifyOriginRelationship(requestUrl: string, targetOrigin: string): BrowserOriginRelationship {
  try {
    return new URL(requestUrl).origin === targetOrigin ? "first-party" : "third-party";
  } catch {
    return "unknown";
  }
}
