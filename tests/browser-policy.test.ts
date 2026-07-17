import { describe, expect, it } from "vitest";
import { DEFAULT_BROWSER_CAPTURE_POLICY, validateCapturePolicy, type BrowserCapturePolicy } from "../src/core/browser-capture-policy.js";

describe("validateCapturePolicy", () => {
  it("accepts the safe default policy", () => {
    expect(validateCapturePolicy(DEFAULT_BROWSER_CAPTURE_POLICY)).toEqual({ ok: true });
  });

  it("has safe-by-default field values", () => {
    expect(DEFAULT_BROWSER_CAPTURE_POLICY.allowExternalNavigation).toBe(false);
    expect(DEFAULT_BROWSER_CAPTURE_POLICY.allowDownloads).toBe(false);
    expect(DEFAULT_BROWSER_CAPTURE_POLICY.allowPopups).toBe(false);
    expect(DEFAULT_BROWSER_CAPTURE_POLICY.blockThirdPartyRequests).toBe(true);
  });

  it("enforces a step count upper bound", () => {
    const policy: BrowserCapturePolicy = { ...DEFAULT_BROWSER_CAPTURE_POLICY, maximumSteps: 5000 };
    const result = validateCapturePolicy(policy);
    expect(result.ok).toBe(false);
  });

  it("enforces a step count lower bound", () => {
    const policy: BrowserCapturePolicy = { ...DEFAULT_BROWSER_CAPTURE_POLICY, maximumSteps: 0 };
    expect(validateCapturePolicy(policy).ok).toBe(false);
  });

  it("enforces a total duration upper bound", () => {
    const policy: BrowserCapturePolicy = { ...DEFAULT_BROWSER_CAPTURE_POLICY, maximumDurationMs: 60 * 60 * 1000 };
    expect(validateCapturePolicy(policy).ok).toBe(false);
  });

  it("rejects a defaultStepTimeoutMs greater than maximumDurationMs", () => {
    const policy: BrowserCapturePolicy = {
      ...DEFAULT_BROWSER_CAPTURE_POLICY,
      maximumDurationMs: 5000,
      defaultStepTimeoutMs: 10000,
    };
    expect(validateCapturePolicy(policy).ok).toBe(false);
  });

  it("rejects allowExternalNavigation:true with an empty allowedOrigins list", () => {
    const policy: BrowserCapturePolicy = { ...DEFAULT_BROWSER_CAPTURE_POLICY, allowExternalNavigation: true, allowedOrigins: [] };
    expect(validateCapturePolicy(policy).ok).toBe(false);
  });

  it("accepts allowExternalNavigation:true with a populated allowedOrigins list", () => {
    const policy: BrowserCapturePolicy = {
      ...DEFAULT_BROWSER_CAPTURE_POLICY,
      allowExternalNavigation: true,
      allowedOrigins: ["https://example.com"],
    };
    expect(validateCapturePolicy(policy).ok).toBe(true);
  });
});
