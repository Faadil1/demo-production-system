import type { ValidationIssue, ValidationResult } from "./types.js";

export type BrowserTargetType = "local" | "explicit-remote";

export type BrowserTarget = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly type: BrowserTargetType;
  readonly baseUrl: string;
  readonly label?: string;
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Parses a target's baseUrl, throwing a descriptive error if it is not a valid absolute URL. */
export function parseBrowserTargetUrl(baseUrl: string): URL {
  return new URL(baseUrl);
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

/**
 * Validates a BrowserTarget against RFC-0004's safety rules: only http/https,
 * no embedded credentials, "local" targets must resolve to a recognized loopback
 * hostname, and "explicit-remote" targets must have their origin present in the
 * capture policy's allowedOrigins. Never rewrites http<->https and never silently
 * follows a target outside its declared origin.
 */
export function validateBrowserTarget(
  target: BrowserTarget,
  policy: { readonly allowedOrigins: readonly string[] },
): ValidationResult {
  const issues: ValidationIssue[] = [];

  let url: URL | null = null;
  try {
    url = new URL(target.baseUrl);
  } catch {
    issues.push({ path: "baseUrl", code: "invalid-url", message: "baseUrl must be a valid absolute URL." });
  }

  if (url) {
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      issues.push({
        path: "baseUrl",
        code: "unsupported-protocol",
        message: `Protocol "${url.protocol}" is not allowed; only "http:" and "https:" are permitted.`,
      });
    }
    if (url.username || url.password) {
      issues.push({
        path: "baseUrl",
        code: "embedded-credentials",
        message: "baseUrl must not embed credentials (user:password@host).",
      });
    }

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLocalHostname = LOCAL_HOSTNAMES.has(hostname);

    if (target.type === "local" && !isLocalHostname) {
      issues.push({
        path: "type",
        code: "not-local",
        message: `Target type is "local" but hostname "${hostname}" is not a recognized loopback hostname (localhost, 127.0.0.1, ::1).`,
      });
    }

    if (target.type === "explicit-remote") {
      if (!policy.allowedOrigins.includes(url.origin)) {
        issues.push({
          path: "baseUrl",
          code: "origin-not-allowlisted",
          message: `Origin "${url.origin}" is not present in policy.allowedOrigins; explicit-remote targets require an explicit allowlist entry.`,
        });
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
