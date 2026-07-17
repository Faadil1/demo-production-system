import { describe, expect, it } from "vitest";
import { evaluateAssertion, validateRegexPattern } from "../src/core/browser-assertion.js";

const observedAt = "2026-07-17T00:00:00.000Z";

describe("evaluateAssertion", () => {
  it("passes a url-equals assertion when actual matches expected", () => {
    const result = evaluateAssertion({
      assertionId: "a1",
      stepId: "s1",
      kind: "url-equals",
      expected: "http://localhost/",
      actual: "http://localhost/",
      observedAt,
      relatedArtifactIds: [],
    });
    expect(result.status).toBe("passed");
  });

  it("fails a url-equals assertion when actual differs, capturing expected/actual", () => {
    const result = evaluateAssertion({
      assertionId: "a1",
      stepId: "s1",
      kind: "url-equals",
      expected: "http://localhost/a",
      actual: "http://localhost/b",
      observedAt,
      relatedArtifactIds: [],
    });
    expect(result.status).toBe("failed");
    expect(result.expected).toBe("http://localhost/a");
    expect(result.actual).toBe("http://localhost/b");
  });

  it("evaluates element-visible / element-hidden from a shared boolean", () => {
    expect(
      evaluateAssertion({ assertionId: "a", stepId: "s", kind: "element-visible", expected: undefined, actual: true, observedAt, relatedArtifactIds: [] })
        .status,
    ).toBe("passed");
    expect(
      evaluateAssertion({ assertionId: "a", stepId: "s", kind: "element-hidden", expected: undefined, actual: false, observedAt, relatedArtifactIds: [] })
        .status,
    ).toBe("passed");
    expect(
      evaluateAssertion({ assertionId: "a", stepId: "s", kind: "element-hidden", expected: undefined, actual: true, observedAt, relatedArtifactIds: [] })
        .status,
    ).toBe("failed");
  });

  it("evaluates count-equals numerically", () => {
    expect(evaluateAssertion({ assertionId: "a", stepId: "s", kind: "count-equals", expected: 3, actual: 3, observedAt, relatedArtifactIds: [] }).status).toBe(
      "passed",
    );
    expect(evaluateAssertion({ assertionId: "a", stepId: "s", kind: "count-equals", expected: 3, actual: 2, observedAt, relatedArtifactIds: [] }).status).toBe(
      "failed",
    );
  });

  it("keeps expected/actual capture safe and inspectable when not sensitive", () => {
    const result = evaluateAssertion({
      assertionId: "a",
      stepId: "s",
      kind: "text-equals",
      expected: "Verified",
      actual: "Not verified",
      observedAt,
      relatedArtifactIds: ["screenshot-1"],
    });
    expect(result.relatedArtifactIds).toEqual(["screenshot-1"]);
    expect(result.message).toContain("Not verified");
  });

  it("redacts actual (and expected) when marked sensitive", () => {
    const result = evaluateAssertion({
      assertionId: "a",
      stepId: "s",
      kind: "value-equals",
      expected: "hunter2",
      actual: "hunter2",
      observedAt,
      relatedArtifactIds: [],
      sensitive: true,
    });
    expect(result.status).toBe("passed");
    expect(result.actual).toBe("[redacted]");
    expect(result.expected).toBe("[redacted]");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("produces status 'error' (not an exception) when the adapter could not observe the value", () => {
    const result = evaluateAssertion({
      assertionId: "a",
      stepId: "s",
      kind: "element-visible",
      expected: undefined,
      actual: null,
      observedAt,
      relatedArtifactIds: [],
      observationError: "Element not found within timeout.",
    });
    expect(result.status).toBe("error");
    expect(result.message).toBe("Element not found within timeout.");
  });

  it("remains a deterministic pure function given the same inputs", () => {
    const args = {
      assertionId: "a",
      stepId: "s",
      kind: "title-equals" as const,
      expected: "TrustCheck",
      actual: "TrustCheck",
      observedAt,
      relatedArtifactIds: [],
    };
    expect(evaluateAssertion(args)).toEqual(evaluateAssertion(args));
  });
});

describe("validateRegexPattern", () => {
  it("accepts a simple, safe pattern", () => {
    expect(validateRegexPattern("^https://localhost/.*$").ok).toBe(true);
  });

  it("rejects a pattern that is too long", () => {
    expect(validateRegexPattern("a".repeat(500)).ok).toBe(false);
  });

  it("rejects an invalid pattern", () => {
    expect(validateRegexPattern("(unclosed").ok).toBe(false);
  });

  it("rejects a pattern with nested quantifiers (catastrophic-backtracking risk)", () => {
    expect(validateRegexPattern("(a+)+").ok).toBe(false);
  });
});
