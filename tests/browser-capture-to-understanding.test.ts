import { describe, expect, it } from "vitest";
import { bridgeBrowserCaptureToUnderstanding } from "../src/bridges/browser-capture-to-understanding.js";
import type { BrowserCaptureResult } from "../src/core/browser-capture-result.js";
import type { BrowserCapturePlan } from "../src/core/browser-capture-plan.js";
import { DEFAULT_BROWSER_CAPTURE_POLICY } from "../src/core/browser-capture-policy.js";

const plan: BrowserCapturePlan = {
  schemaVersion: "0.1",
  id: "plan-1",
  target: { schemaVersion: "0.1", id: "t1", type: "local", baseUrl: "http://localhost:4173" },
  viewport: { width: 1280, height: 720 },
  policy: DEFAULT_BROWSER_CAPTURE_POLICY,
  steps: [],
  evidenceRequirements: [
    { id: "req-satisfied", claim: "Result shown.", requiredArtifactKinds: ["assertion"], requiredAssertionIds: ["a1"], minimumVerifiedArtifacts: 1, importance: "critical" },
    { id: "req-unsatisfied", claim: "DOM proof.", requiredArtifactKinds: ["dom-snapshot"], requiredAssertionIds: [], minimumVerifiedArtifacts: 1, importance: "supporting" },
  ],
};

function makeResult(overrides: Partial<BrowserCaptureResult> = {}): BrowserCaptureResult {
  return {
    schemaVersion: "0.1",
    capturePlanId: "plan-1",
    targetId: "t1",
    launch: { launched: true, browserName: "chromium", browserVersion: "1.0", failureReason: null },
    finalUrl: "http://localhost:4173/",
    durationMs: 100,
    stepResults: [],
    assertions: [
      { assertionId: "a1", stepId: "a1", kind: "element-visible", status: "passed", expected: true, actual: true, message: "ok", observedAt: "2026-07-17T00:00:00Z", relatedArtifactIds: [] },
      { assertionId: "a2", stepId: "a2", kind: "element-visible", status: "failed", expected: true, actual: false, message: "no", observedAt: "2026-07-17T00:00:00Z", relatedArtifactIds: [] },
    ],
    screenshots: [
      { id: "screenshot-s1", stepId: "s1", path: "/tmp/s1.png", fileName: "s1.png", mimeType: "image/png", width: 10, height: 10, fullPage: false, selector: null, contentHash: "a".repeat(64), capturedAt: "2026-07-17T00:00:00Z", maskedSelectorCount: 0 },
    ],
    domSnapshots: [],
    consoleRecords: [],
    networkRecords: [],
    safetyViolations: [],
    evidenceManifest: {
      schemaVersion: "0.1",
      capturePlanId: "plan-1",
      targetId: "t1",
      runId: "run-1",
      artifacts: [],
      assertions: [],
      observations: [],
      coverage: { requirementCount: 2, satisfiedCount: 1, criticalRequirementCount: 1, satisfiedCriticalCount: 1, verifiedArtifactCount: 2, coverageRatio: 0.5, sufficient: false },
      unresolvedRequirements: [{ requirementId: "req-unsatisfied", claim: "DOM proof.", satisfied: false, importance: "supporting", reason: "no DOM snapshot" }],
    },
    observationTimeline: { schemaVersion: "0.1", sourceId: "t1", observations: [] },
    gate: { name: "browser-capture", status: "conditional", blockingReasons: [], warnings: [], requirementsBeforeUse: [] },
    ...overrides,
  };
}

describe("bridgeBrowserCaptureToUnderstanding", () => {
  it("bridges only passed assertions as verified evidence", () => {
    const bridged = bridgeBrowserCaptureToUnderstanding(plan, makeResult(), "run-1");
    const assertionEvidence = bridged.evidence.filter((e) => e.id.startsWith("capture-evidence-assertion-"));
    expect(assertionEvidence).toHaveLength(1);
    expect(assertionEvidence[0]?.id).toBe("capture-evidence-assertion-a1");
    expect(assertionEvidence.every((e) => e.verificationStatus === "verified")).toBe(true);
  });

  it("bridges every screenshot as verified 'pixels captured' evidence, not a business claim", () => {
    const bridged = bridgeBrowserCaptureToUnderstanding(plan, makeResult(), "run-1");
    const screenshotEvidence = bridged.evidence.find((e) => e.id.startsWith("capture-evidence-screenshot-"));
    expect(screenshotEvidence).toBeDefined();
    expect(screenshotEvidence?.verificationStatus).toBe("verified");
    expect(screenshotEvidence?.claim).toContain("pixels captured");
    expect(screenshotEvidence?.claim).not.toMatch(/proves|guarantees/i);
  });

  it("bridges only satisfied evidence requirements", () => {
    const bridged = bridgeBrowserCaptureToUnderstanding(plan, makeResult(), "run-1");
    const requirementEvidence = bridged.evidence.filter((e) => e.id.startsWith("capture-evidence-requirement-"));
    expect(requirementEvidence).toHaveLength(1);
    expect(requirementEvidence[0]?.id).toBe("capture-evidence-requirement-req-satisfied");
  });

  it("never bridges an unsatisfied requirement or a failed assertion", () => {
    const bridged = bridgeBrowserCaptureToUnderstanding(plan, makeResult(), "run-1");
    expect(bridged.evidence.some((e) => e.id.includes("req-unsatisfied"))).toBe(false);
    expect(bridged.evidence.some((e) => e.id.includes("-a2"))).toBe(false);
  });

  it("preserves the observation timeline unchanged", () => {
    const result = makeResult({ observationTimeline: { schemaVersion: "0.1", sourceId: "t1", observations: [] } });
    const bridged = bridgeBrowserCaptureToUnderstanding(plan, result, "run-1");
    expect(bridged.observations).toEqual(result.observationTimeline);
  });

  it("never mutates the input plan or result", () => {
    const result = makeResult();
    const planSnapshot = JSON.stringify(plan);
    const resultSnapshot = JSON.stringify(result);
    bridgeBrowserCaptureToUnderstanding(plan, result, "run-1");
    expect(JSON.stringify(plan)).toBe(planSnapshot);
    expect(JSON.stringify(result)).toBe(resultSnapshot);
  });

  it("is deterministic across repeated calls", () => {
    const result = makeResult();
    expect(bridgeBrowserCaptureToUnderstanding(plan, result, "run-1")).toEqual(bridgeBrowserCaptureToUnderstanding(plan, result, "run-1"));
  });
});
