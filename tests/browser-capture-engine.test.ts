import { describe, expect, it } from "vitest";
import { BrowserCaptureEngine } from "../src/engines/browser-capture.js";
import type { BrowserAdapter, BrowserAdapterExecution, BrowserAdapterExecuteOptions } from "../src/adapters/browser-adapter.js";
import type { EngineContext } from "../src/core/engine.js";
import { DEFAULT_BROWSER_CAPTURE_POLICY } from "../src/core/browser-capture-policy.js";
import type { BrowserCapturePlan, BrowserCaptureStep } from "../src/core/browser-capture-plan.js";

const context: EngineContext = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };

class FakeBrowserAdapter implements BrowserAdapter {
  readonly name = "fake-browser-adapter";
  readonly version = "0.0.0";
  constructor(private readonly execution: BrowserAdapterExecution) {}
  async execute(_plan: BrowserCapturePlan, _context: EngineContext, _options: BrowserAdapterExecuteOptions): Promise<BrowserAdapterExecution> {
    return this.execution;
  }
}

function plan(steps: readonly BrowserCaptureStep[], overrides: Partial<BrowserCapturePlan> = {}): BrowserCapturePlan {
  return {
    schemaVersion: "0.1",
    id: "plan-1",
    target: { schemaVersion: "0.1", id: "t1", type: "local", baseUrl: "http://localhost:4173" },
    viewport: { width: 1280, height: 720 },
    policy: DEFAULT_BROWSER_CAPTURE_POLICY,
    steps,
    evidenceRequirements: [],
    ...overrides,
  };
}

const launchedOk = { launched: true, browserName: "chromium", browserVersion: "1.0", failureReason: null };

/** The canonical "full sequence" plan+execution: navigate, click, assert (critical), screenshot. */
function fullSequence(assertVerified: boolean, assertPassed = true) {
  const steps: BrowserCaptureStep[] = [
    { id: "nav", kind: "navigate", description: "Navigate.", path: "/", waitUntil: "load" },
    { id: "click", kind: "click", description: "Click verify.", selector: { strategy: "test-id", value: "verify" } },
    {
      id: "assert-result",
      kind: "assert",
      description: "Assert result visible.",
      assertionKind: "element-visible",
      selector: { strategy: "test-id", value: "result" },
      importance: "critical",
    },
    { id: "shot", kind: "screenshot", description: "Screenshot after.", artifactName: "after", fullPage: false, animations: "disabled" },
  ];

  const execution: BrowserAdapterExecution = {
    launch: launchedOk,
    finalUrl: "http://localhost:4173/",
    durationMs: 500,
    stepResults: [
      { stepId: "nav", kind: "navigate", status: "completed", message: "ok", startedAtMs: 0, endedAtMs: 50, blocking: true },
      { stepId: "click", kind: "click", status: "completed", message: "ok", startedAtMs: 50, endedAtMs: 100, blocking: true },
      { stepId: "assert-result", kind: "assert", status: "completed", message: "ok", startedAtMs: 100, endedAtMs: 120, blocking: true },
      { stepId: "shot", kind: "screenshot", status: "completed", message: "ok", startedAtMs: 120, endedAtMs: 150, blocking: true },
    ],
    assertionObservations: [
      {
        assertionId: "assert-result",
        stepId: "assert-result",
        kind: "element-visible",
        actual: assertPassed,
        observedAtMs: 110,
        relatedArtifactIds: [],
        ...(assertVerified ? {} : {}),
      },
    ],
    screenshots: [
      {
        id: "screenshot-shot",
        stepId: "shot",
        path: "/tmp/after.png",
        fileName: "after.png",
        mimeType: "image/png",
        width: 1280,
        height: 720,
        fullPage: false,
        selector: null,
        contentHash: "a".repeat(64),
        capturedAt: "2026-07-17T00:00:00.000Z",
        maskedSelectorCount: 0,
      },
    ],
    domSnapshots: [],
    consoleRecords: [],
    networkRecords: [],
    safetyViolations: [],
  };

  return { plan: plan(steps), execution };
}

describe("BrowserCaptureEngine — observations", () => {
  it("produces interaction-start for a completed click", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.observationTimeline.observations.some((o) => o.kind === "interaction-start")).toBe(true);
  });

  it("produces result-visible for a passed critical assertion after a click", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.observationTimeline.observations.some((o) => o.kind === "result-visible")).toBe(true);
    expect(result.observationTimeline.observations.some((o) => o.kind === "interaction-complete")).toBe(true);
  });

  it("produces proof-visible only when a screenshot directly follows a passed post-click assertion", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.observationTimeline.observations.some((o) => o.kind === "proof-visible")).toBe(true);
  });

  it("does NOT produce proof-visible from a screenshot alone with no preceding passed assertion", async () => {
    const steps: BrowserCaptureStep[] = [
      { id: "nav", kind: "navigate", description: "Navigate.", path: "/", waitUntil: "load" },
      { id: "shot", kind: "screenshot", description: "Just a screenshot.", artifactName: "solo", fullPage: false, animations: "disabled" },
    ];
    const execution: BrowserAdapterExecution = {
      launch: launchedOk,
      finalUrl: "http://localhost:4173/",
      durationMs: 100,
      stepResults: [
        { stepId: "nav", kind: "navigate", status: "completed", message: "ok", startedAtMs: 0, endedAtMs: 10, blocking: true },
        { stepId: "shot", kind: "screenshot", status: "completed", message: "ok", startedAtMs: 10, endedAtMs: 20, blocking: true },
      ],
      assertionObservations: [],
      screenshots: [
        {
          id: "screenshot-shot",
          stepId: "shot",
          path: "/tmp/solo.png",
          fileName: "solo.png",
          mimeType: "image/png",
          width: 100,
          height: 100,
          fullPage: false,
          selector: null,
          contentHash: "b".repeat(64),
          capturedAt: "2026-07-17T00:00:00.000Z",
          maskedSelectorCount: 0,
        },
      ],
      domSnapshots: [],
      consoleRecords: [],
      networkRecords: [],
      safetyViolations: [],
    };

    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: plan(steps), screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.observationTimeline.observations.some((o) => o.kind === "proof-visible")).toBe(false);
    // A screenshot before any click is classified as before-state, not fabricated proof.
    expect(result.observationTimeline.observations.some((o) => o.kind === "before-state")).toBe(true);
  });

  it("never produces a verified proof-visible observation from a FAILED assertion", async () => {
    const { plan: capturePlan, execution } = fullSequence(true, false);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.observationTimeline.observations.some((o) => o.kind === "proof-visible")).toBe(false);
    expect(result.observationTimeline.observations.some((o) => o.kind === "result-visible")).toBe(false);
  });

  it("marks all generated observations sourceType 'capture' with verificationStatus 'verified'", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    for (const observation of result.observationTimeline.observations) {
      expect(observation.sourceType).toBe("capture");
      expect(observation.verificationStatus).toBe("verified");
    }
  });

  it("references only real artifact/assertion IDs in relatedEvidenceIds", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    const knownIds = new Set([
      ...capturePlan.steps.map((s) => s.id),
      ...result.assertions.map((a) => a.assertionId),
      ...result.screenshots.map((s) => s.id),
    ]);
    for (const observation of result.observationTimeline.observations) {
      for (const id of observation.relatedEvidenceIds) {
        expect(knownIds.has(id)).toBe(true);
      }
    }
  });

  it("does not mutate the input plan", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const snapshot = JSON.stringify(capturePlan);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(JSON.stringify(capturePlan)).toBe(snapshot);
  });
});

describe("BrowserCaptureEngine — evidence coverage", () => {
  it("marks a critical requirement satisfied and reflects it in coverage", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const withRequirement = plan(capturePlan.steps, {
      evidenceRequirements: [
        {
          id: "req-1",
          claim: "Result is shown.",
          requiredArtifactKinds: ["screenshot", "assertion"],
          requiredAssertionIds: ["assert-result"],
          minimumVerifiedArtifacts: 1,
          importance: "critical",
        },
      ],
    });
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: withRequirement, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.evidenceManifest.coverage.satisfiedCriticalCount).toBe(1);
    expect(result.evidenceManifest.unresolvedRequirements).toHaveLength(0);
    expect(result.gate.status).toBe("pass");
  });

  it("fails the gate when a critical evidence requirement is unsatisfied", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const withRequirement = plan(capturePlan.steps, {
      evidenceRequirements: [
        {
          id: "req-missing",
          claim: "Something never captured.",
          requiredArtifactKinds: ["dom-snapshot"],
          requiredAssertionIds: [],
          minimumVerifiedArtifacts: 1,
          importance: "critical",
        },
      ],
    });
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: withRequirement, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("fail");
  });

  it("marks the gate conditional (not fail) when only an optional requirement is unsatisfied", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const withRequirement = plan(capturePlan.steps, {
      evidenceRequirements: [
        {
          id: "req-optional",
          claim: "Optional dom snapshot.",
          requiredArtifactKinds: ["dom-snapshot"],
          requiredAssertionIds: [],
          minimumVerifiedArtifacts: 1,
          importance: "supporting",
        },
      ],
    });
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: withRequirement, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("conditional");
  });

  it("computes a deterministic coverage ratio within [0, 1]", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.evidenceManifest.coverage.coverageRatio).toBeGreaterThanOrEqual(0);
    expect(result.evidenceManifest.coverage.coverageRatio).toBeLessThanOrEqual(1);
  });
});

describe("BrowserCaptureEngine — gate", () => {
  it("passes for a fully valid offline capture", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("pass");
  });

  it("fails when a critical assertion fails", async () => {
    const { plan: capturePlan, execution } = fullSequence(true, false);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("fail");
    expect(result.gate.blockingReasons.some((reason) => reason.includes("Critical assertion"))).toBe(true);
  });

  it("fails when the browser is unavailable", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const unavailable: BrowserAdapterExecution = {
      ...execution,
      launch: { launched: false, browserName: "chromium", browserVersion: null, failureReason: "Executable not found." },
      stepResults: [],
      assertionObservations: [],
      screenshots: [],
    };
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(unavailable));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("fail");
  });

  it("fails when no verified evidence exists at all", async () => {
    const empty: BrowserAdapterExecution = {
      launch: launchedOk,
      finalUrl: "http://localhost:4173/",
      durationMs: 10,
      stepResults: [{ stepId: "nav", kind: "navigate", status: "completed", message: "ok", startedAtMs: 0, endedAtMs: 5, blocking: true }],
      assertionObservations: [],
      screenshots: [],
      domSnapshots: [],
      consoleRecords: [],
      networkRecords: [],
      safetyViolations: [],
    };
    const navOnly = plan([{ id: "nav", kind: "navigate", description: "Navigate.", path: "/", waitUntil: "load" }]);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(empty));
    const result = await engine.run({ plan: navOnly, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("fail");
  });

  it("fails when navigation was blocked outside the allowed origin", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const blocked: BrowserAdapterExecution = {
      ...execution,
      safetyViolations: [{ id: "safety-1", kind: "origin-disallowed", message: "Blocked.", stepId: "nav" }],
    };
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(blocked));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("fail");
  });

  it("fails on execution timeout (duration at or beyond the policy maximum)", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const timedOut: BrowserAdapterExecution = { ...execution, durationMs: capturePlan.policy.maximumDurationMs };
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(timedOut));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("fail");
  });

  it("is conditional when only a non-critical assertion failed", async () => {
    const steps: BrowserCaptureStep[] = [
      { id: "nav", kind: "navigate", description: "Navigate.", path: "/", waitUntil: "load" },
      {
        id: "assert-optional",
        kind: "assert",
        description: "Optional check.",
        assertionKind: "element-visible",
        selector: { strategy: "test-id", value: "banner" },
        importance: "supporting",
      },
      { id: "shot", kind: "screenshot", description: "Screenshot.", artifactName: "shot", fullPage: false, animations: "disabled" },
    ];
    const execution: BrowserAdapterExecution = {
      launch: launchedOk,
      finalUrl: "http://localhost:4173/",
      durationMs: 50,
      stepResults: [
        { stepId: "nav", kind: "navigate", status: "completed", message: "ok", startedAtMs: 0, endedAtMs: 10, blocking: true },
        { stepId: "assert-optional", kind: "assert", status: "completed", message: "ok", startedAtMs: 10, endedAtMs: 20, blocking: true },
        { stepId: "shot", kind: "screenshot", status: "completed", message: "ok", startedAtMs: 20, endedAtMs: 30, blocking: true },
      ],
      assertionObservations: [
        { assertionId: "assert-optional", stepId: "assert-optional", kind: "element-visible", actual: false, observedAtMs: 15, relatedArtifactIds: [] },
      ],
      screenshots: [
        {
          id: "screenshot-shot",
          stepId: "shot",
          path: "/tmp/shot.png",
          fileName: "shot.png",
          mimeType: "image/png",
          width: 100,
          height: 100,
          fullPage: false,
          selector: null,
          contentHash: "c".repeat(64),
          capturedAt: "2026-07-17T00:00:00.000Z",
          maskedSelectorCount: 0,
        },
      ],
      domSnapshots: [],
      consoleRecords: [],
      networkRecords: [],
      safetyViolations: [],
    };
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: plan(steps), screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(result.gate.status).toBe("conditional");
  });
});

describe("BrowserCaptureEngine — validate/verify contract", () => {
  it("delegates validate() to plan validation", () => {
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(fullSequence(true).execution));
    const invalidPlan = plan([]); // empty steps -> invalid
    const result = engine.validate({ plan: invalidPlan, screenshotsDir: "/tmp", domDir: "/tmp" });
    expect(result.ok).toBe(false);
  });

  it("verify() fails for a failed gate and succeeds otherwise", async () => {
    const { plan: capturePlan, execution } = fullSequence(true, false);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const result = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(engine.verify(result).ok).toBe(false);

    const { plan: okPlan, execution: okExecution } = fullSequence(true, true);
    const okEngine = new BrowserCaptureEngine(new FakeBrowserAdapter(okExecution));
    const okResult = await okEngine.run({ plan: okPlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(okEngine.verify(okResult).ok).toBe(true);
  });

  it("records decisions for evidence coverage and the capture gate", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    const decisions = engine.decisionsFromLastRun();
    expect(decisions.some((d) => d.decisionId.includes("evidence-coverage"))).toBe(true);
    expect(decisions.some((d) => d.decisionId.includes("capture-gate"))).toBe(true);
  });

  it("is deterministic across repeated runs of identical input", async () => {
    const { plan: capturePlan, execution } = fullSequence(true);
    const engine = new BrowserCaptureEngine(new FakeBrowserAdapter(execution));
    const a = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    const b = await engine.run({ plan: capturePlan, screenshotsDir: "/tmp", domDir: "/tmp" }, context);
    expect(a).toEqual(b);
  });
});
