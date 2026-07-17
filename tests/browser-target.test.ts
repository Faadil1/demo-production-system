import { describe, expect, it } from "vitest";
import { validateBrowserTarget, type BrowserTarget } from "../src/core/browser-target.js";

function target(overrides: Partial<BrowserTarget>): BrowserTarget {
  return { schemaVersion: "0.1", id: "t1", type: "local", baseUrl: "http://localhost:3000", ...overrides };
}

describe("validateBrowserTarget", () => {
  it("accepts localhost", () => {
    expect(validateBrowserTarget(target({ baseUrl: "http://localhost:3000" }), { allowedOrigins: [] }).ok).toBe(true);
  });

  it("accepts loopback IPv4", () => {
    expect(validateBrowserTarget(target({ baseUrl: "http://127.0.0.1:3000" }), { allowedOrigins: [] }).ok).toBe(true);
  });

  it("accepts loopback IPv6", () => {
    expect(validateBrowserTarget(target({ baseUrl: "http://[::1]:3000" }), { allowedOrigins: [] }).ok).toBe(true);
  });

  it("rejects an unsupported protocol", () => {
    for (const uri of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://localhost/x", "chrome://settings"]) {
      const result = validateBrowserTarget(target({ baseUrl: uri }), { allowedOrigins: [] });
      expect(result.ok, uri).toBe(false);
    }
  });

  it("rejects embedded credentials in the URL", () => {
    const result = validateBrowserTarget(target({ baseUrl: "http://user:pass@localhost:3000" }), { allowedOrigins: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "embedded-credentials")).toBe(true);
  });

  it("rejects a remote origin unless explicitly allowlisted", () => {
    const result = validateBrowserTarget(
      target({ type: "explicit-remote", baseUrl: "https://example.com/app" }),
      { allowedOrigins: [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "origin-not-allowlisted")).toBe(true);
  });

  it("accepts an explicit-remote origin when allowlisted", () => {
    const result = validateBrowserTarget(
      target({ type: "explicit-remote", baseUrl: "https://example.com/app" }),
      { allowedOrigins: ["https://example.com"] },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a 'local' target whose hostname is not actually loopback", () => {
    const result = validateBrowserTarget(target({ type: "local", baseUrl: "http://example.com" }), { allowedOrigins: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "not-local")).toBe(true);
  });

  it("rejects a malformed URL", () => {
    expect(validateBrowserTarget(target({ baseUrl: "not a url" }), { allowedOrigins: [] }).ok).toBe(false);
  });
});
