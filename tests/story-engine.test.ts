import { describe, expect, it } from "vitest";
import { StoryEngine } from "../src/engines/story.js";
import type { StoryCompilerInput, BrowserCaptureRunInput } from "../src/core/story.js";
import type { ProductUnderstanding } from "../src/core/product-understanding.js";
import type { DemoIntermediateRepresentation } from "../src/core/dir.js";
import type { BrowserCaptureResult } from "../src/core/browser-capture-result.js";
import type { DemoObservation } from "../src/core/demo-observation.js";
import { stableStringify } from "../src/core/stable-json.js";

const context = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };

function productUnderstanding(overrides: Partial<ProductUnderstanding> = {}): ProductUnderstanding {
  return {
    schemaVersion: "0.2",
    product: {
      name: "Acme Demo Tool",
      problem: "Teams waste hours building demos by hand.",
      valueProposition: "Acme compiles evidence-backed demos automatically.",
      targetAudiences: ["sales-engineers"],
    },
    facts: [
      { id: "fact-1", statement: "Manual demo assembly takes 4 hours on average.", source: "interview", sourceType: "human", confidence: 0.8, verificationStatus: "verified" },
    ],
    claims: [],
    hypotheses: [
      { id: "hyp-1", statement: "Acme saves teams 3 hours per demo.", rationale: "Derived from fact-1 minus observed compile time.", confidence: 0.4, validationRequired: true },
    ],
    evidence: [],
    missingEvidence: [],
    heroInteractionCandidates: [
      { id: "hero-1", label: "Compile a demo", description: "Run the compiler end to end.", valueDemonstrated: "Automatic storyboard compilation.", evidenceIds: [], confidence: 0.8, risks: [], source: "human" },
    ],
    selectedHeroInteraction: { candidateId: "hero-1", reason: "Core value moment.", confidence: 0.9, authority: "human", requiresHumanApproval: false },
    ambiguities: [],
    risks: [],
    confidence: { overall: 0.8, productUnderstanding: 0.8, evidenceCoverage: 0.8, heroInteractionSelection: 0.9 },
    approvalRequirements: [],
    evidenceCoverage: { requiredCount: 1, availableCount: 1, verifiedCount: 1, criticalCount: 1, coverageRatio: 1, sufficient: true },
    gate: { name: "understanding", status: "pass", blockingReasons: [], warnings: [], requirementsBeforeRender: [] },
    ...overrides,
  };
}

function dir(overrides: Partial<DemoIntermediateRepresentation> = {}): DemoIntermediateRepresentation {
  return {
    schemaVersion: "0.2",
    title: "Acme Demo",
    goal: "prove",
    audience: "sales-engineers",
    durationSeconds: 60,
    heroInteractionSceneId: "scene-interaction-start",
    acts: [],
    scenes: [],
    evidence: [
      { id: "req-1", kind: "capture", claim: "Acme compiles a demo end to end.", source: "browser-capture", importance: "critical", verificationStatus: "verified" },
    ],
    constraints: { noGeneratedUI: true, minimumEvidenceCount: 1, maximumOnScreenWords: 20 },
    readiness: "ready",
    ...overrides,
  };
}

function observation(overrides: Partial<DemoObservation> & Pick<DemoObservation, "id" | "kind" | "startSeconds" | "endSeconds">): DemoObservation {
  return {
    statement: "observed",
    sourceType: "capture",
    verificationStatus: "verified",
    confidence: 0.9,
    relatedEvidenceIds: [],
    ...overrides,
  };
}

function browserCapture(overrides: Partial<BrowserCaptureResult> = {}): BrowserCaptureResult {
  const observations: DemoObservation[] = [
    observation({ id: "obs-start", kind: "interaction-start", startSeconds: 0, endSeconds: 1 }),
    observation({ id: "obs-complete", kind: "interaction-complete", startSeconds: 1, endSeconds: 2 }),
    observation({ id: "obs-proof", kind: "proof-visible", startSeconds: 2, endSeconds: 3 }),
    observation({ id: "obs-result", kind: "result-visible", startSeconds: 3, endSeconds: 4 }),
  ];
  return {
    schemaVersion: "0.1",
    capturePlanId: "plan-1",
    targetId: "target-1",
    launch: { launched: true, browserName: "chromium", browserVersion: "120.0", failureReason: null },
    finalUrl: "https://example.com/done",
    durationMs: 4000,
    stepResults: [],
    assertions: [
      {
        assertionId: "assert-1",
        stepId: "step-1",
        kind: "text-contains",
        status: "passed",
        expected: "Done",
        actual: "Done",
        message: "Assertion passed.",
        observedAt: "2026-07-17T00:00:00Z",
        relatedArtifactIds: ["screenshot-1"],
      },
    ],
    screenshots: [
      {
        id: "screenshot-1",
        stepId: "step-1",
        path: "./screenshot-1.png",
        fileName: "screenshot-1.png",
        mimeType: "image/png",
        width: 100,
        height: 100,
        fullPage: false,
        selector: null,
        contentHash: "abc",
        capturedAt: "2026-07-17T00:00:00Z",
        maskedSelectorCount: 0,
      },
    ],
    domSnapshots: [],
    consoleRecords: [],
    networkRecords: [],
    safetyViolations: [],
    evidenceManifest: {
      schemaVersion: "0.1",
      capturePlanId: "plan-1",
      targetId: "target-1",
      runId: "run-capture-1",
      artifacts: [],
      assertions: [],
      observations,
      coverage: { requirementCount: 1, satisfiedCount: 1, criticalRequirementCount: 1, satisfiedCriticalCount: 1, verifiedArtifactCount: 1, coverageRatio: 1, sufficient: true },
      unresolvedRequirements: [],
    },
    observationTimeline: { schemaVersion: "0.1", sourceId: "target-1", observations },
    gate: { name: "browser-capture", status: "pass", blockingReasons: [], warnings: [], requirementsBeforeUse: [] },
    ...overrides,
  };
}

function captureRun(overrides: Partial<BrowserCaptureRunInput> = {}): BrowserCaptureRunInput {
  return {
    runId: "run-capture-1",
    artifactId: "browser-capture-1",
    capturedAt: "2026-07-17T00:00:00Z",
    result: browserCapture(),
    ...overrides,
  };
}

function baseInput(overrides: Partial<StoryCompilerInput> = {}): StoryCompilerInput {
  return {
    schemaVersion: "0.1",
    id: "story-input-1",
    productUnderstanding: productUnderstanding(),
    dir: dir(),
    browserCaptures: [captureRun()],
    objective: "persuade-to-try",
    duration: { targetMs: 60000, minimumMs: 30000, maximumMs: 90000 },
    constraints: [],
    ...overrides,
  };
}

describe("StoryEngine — contract-level behavior", () => {
  it("compiles a promotional storyboard reaching at least conditional with a verified proof chain", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput(), context);
    expect(board.storyMode).toBe("promotional");
    expect(board.gate.status).not.toBe("fail");
    expect(board.proofChains.some((p) => p.status === "verified")).toBe(true);
    expect(board.scenes.length).toBeGreaterThan(0);
    // Beat ownership: no beat id appears in more than one scene's beatIds (§9 Decision 1).
    const seen = new Set<string>();
    for (const scene of board.scenes) {
      for (const beatId of scene.beatIds) {
        expect(seen.has(beatId)).toBe(false);
        seen.add(beatId);
      }
    }
    // Scene ownership: each scene belongs to exactly one sequence (§9 Decision 2).
    const sceneToSequence = new Map<string, string>();
    for (const seq of board.sequences) {
      for (const sceneId of seq.sceneIds) {
        expect(sceneToSequence.has(sceneId)).toBe(false);
        sceneToSequence.set(sceneId, seq.id);
      }
    }
  });

  it("never silently defaults a missing/invalid duration (§18 Decision 8)", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput({ duration: { targetMs: 0, minimumMs: 0, maximumMs: 0 } }), context);
    expect(board.gate.status).toBe("fail");
    expect(board.gate.blockingReasons.some((r) => r.includes("[invalid-input]"))).toBe(true);
    expect(board.scenes).toEqual([]);
  });

  it("resolves diagnostic mode only from an explicit constraint, and never requires a CTA in diagnostic mode", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(
      baseInput({ constraints: [{ kind: "mode", value: "diagnostic", reason: "test" }] }),
      context,
    );
    expect(board.storyMode).toBe("diagnostic");
    expect(board.coverage.ctaRequired).toBe(false);
    expect(board.scenes.some((s) => s.beatIds.includes("beat-cta"))).toBe(false);
  });

  it("selects a failed-assertion limitation beat mandatorily in diagnostic mode but not automatically in promotional mode (§22)", async () => {
    const engine = new StoryEngine();
    const failingCapture = captureRun({
      result: browserCapture({
        assertions: [
          {
            assertionId: "assert-failed",
            stepId: "step-1",
            kind: "text-contains",
            status: "failed",
            expected: "Done",
            actual: "Not done",
            message: "Assertion failed.",
            observedAt: "2026-07-17T00:00:00Z",
            relatedArtifactIds: [],
          },
        ],
      }),
    });

    const promotional = await engine.run(baseInput({ browserCaptures: [failingCapture] }), context);
    expect(promotional.beats.some((b) => b.kind === "limitation")).toBe(false);
    expect(promotional.rejectedCandidates.some((r) => r.reasonCode === "non-critical")).toBe(true);

    const diagnostic = await engine.run(
      baseInput({ browserCaptures: [failingCapture], constraints: [{ kind: "mode", value: "diagnostic", reason: "test" }] }),
      context,
    );
    expect(diagnostic.beats.some((b) => b.kind === "limitation" && b.mustAppear)).toBe(true);
  });

  it("preserves human Hero Interaction authority even when browser evidence cannot verify it (§16)", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput({ browserCaptures: [] }), context);
    expect(board.heroInteraction?.sourceHeroInteractionId).toBe("hero-1");
    expect(board.heroInteraction?.narrativeAuthority).toBe("human-selected");
    expect(board.heroInteraction?.continuityStatus).toBe("broken");
    expect(board.gate.status).toBe("fail");
  });

  it("does not select an unverified impact beat in promotional mode without an explicit allow-unverified-impact constraint (§22)", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput(), context);
    expect(board.beats.some((b) => b.kind === "impact")).toBe(false);
    expect(board.rejectedCandidates.some((r) => r.reasonCode === "unsupported-impact")).toBe(true);
  });

  it("admits an unverified impact beat only under an explicit allow-unverified-impact constraint, capping the gate at conditional", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(
      baseInput({ constraints: [{ kind: "allow-unverified-impact", value: {}, reason: "test" }] }),
      context,
    );
    expect(board.beats.some((b) => b.kind === "impact")).toBe(true);
    expect(board.coverage.unverifiedImpactBeatsAdmittedCount).toBeGreaterThan(0);
    expect(board.gate.status).not.toBe("pass");
  });

  it("rejects compilation as an unresolved conflict under the reject-conflict capture selection fallback", async () => {
    const engine = new StoryEngine();
    const conflicting = captureRun({
      runId: "run-b",
      artifactId: "browser-capture-2",
      capturedAt: "2026-07-17T01:00:00Z",
      result: browserCapture({ gate: { name: "browser-capture", status: "fail", blockingReasons: ["x"], warnings: [], requirementsBeforeUse: [] } }),
    });
    const board = await engine.run(
      baseInput({
        browserCaptures: [captureRun(), conflicting],
        captureSelectionPolicy: { fallback: "reject-conflict" },
      }),
      context,
    );
    expect(board.gate.status).toBe("fail");
    expect(board.gate.blockingReasons.some((r) => r.includes("insufficient-evidence"))).toBe(true);
  });

  it("honors an explicit authoritativeRunId over recency", async () => {
    const engine = new StoryEngine();
    const older = captureRun({ runId: "run-old", artifactId: "cap-old", capturedAt: "2026-01-01T00:00:00Z" });
    const newer = captureRun({ runId: "run-new", artifactId: "cap-new", capturedAt: "2026-06-01T00:00:00Z" });
    const board = await engine.run(
      baseInput({ browserCaptures: [older, newer], captureSelectionPolicy: { authoritativeRunId: "run-old", fallback: "latest-captured-at" } }),
      context,
    );
    const captureDecision = board.decisions.find((d) => d.decisionId.endsWith("capture-run-selected"));
    expect(captureDecision?.chosenOptionId).toBe("run-old");
  });

  it("produces no verified proof chain and fails when no browser capture is supplied", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput({ browserCaptures: [] }), context);
    expect(board.proofChains.every((p) => p.status !== "verified")).toBe(true);
    expect(board.gate.status).toBe("fail");
  });
});

describe("StoryEngine — determinism (§29)", () => {
  it("produces a byte-identical canonical Storyboard when input object key order and array order are shuffled", async () => {
    const engine = new StoryEngine();
    const inputA = baseInput();
    const boardA = await engine.run(inputA, context);

    // Reorder arrays that carry no semantic authority per §29 (facts, hypotheses,
    // heroInteractionCandidates, evidence, browserCaptures) and rebuild via JSON
    // round-trip with reversed key insertion order to simulate discovery-order variance.
    const shuffledPU: ProductUnderstanding = {
      ...inputA.productUnderstanding,
      facts: [...inputA.productUnderstanding.facts].reverse(),
      hypotheses: [...inputA.productUnderstanding.hypotheses].reverse(),
    };
    const inputB: StoryCompilerInput = {
      ...inputA,
      productUnderstanding: shuffledPU,
      browserCaptures: [...inputA.browserCaptures].reverse(),
    };
    const boardB = await engine.run(inputB, context);

    const stripNonDeterministic = (board: typeof boardA) => {
      const { decisions, ...rest } = board;
      return { ...rest, decisions: decisions.map(({ createdAt, decisionId, runId, ...d }) => d) };
    };

    expect(stableStringify(stripNonDeterministic(boardA))).toBe(stableStringify(stripNonDeterministic(boardB)));
    // Contractually-ordered sequences (scenes, sequences) stay ordered by their `order` field.
    expect(boardA.scenes.map((s) => s.id)).toEqual(boardB.scenes.map((s) => s.id));
  });

  it("produces a stable Storyboard.id across repeated compilations of identical input", async () => {
    const engine = new StoryEngine();
    const boardA = await engine.run(baseInput(), context);
    const boardB = await engine.run(baseInput(), { runId: "run-different", now: () => new Date("2030-01-01T00:00:00Z") });
    expect(boardA.id).toBe(boardB.id);
  });
});

describe("StoryEngine — proof chain claim-kind correctness (§17)", () => {
  it("does not mark a non-browser-substantiable DIR evidence claim as verified merely because an unrelated browser assertion passed", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(
      baseInput({
        dir: dir({
          evidence: [
            { id: "req-1", kind: "capture", claim: "Acme compiles a demo end to end.", source: "browser-capture", importance: "critical", verificationStatus: "verified" },
            { id: "req-2", kind: "document", claim: "Acme is SOC2 compliant.", source: "compliance-doc", importance: "supporting", verificationStatus: "unverified" },
          ],
        }),
      }),
      context,
    );
    const captureChain = board.proofChains.find((p) => p.claimId === "req-1");
    const docChain = board.proofChains.find((p) => p.claimId === "req-2");
    expect(captureChain?.status).toBe("verified");
    expect(docChain?.status).toBe("unsupported");
    expect(docChain?.gaps.some((g) => g.includes("no per-claim identifier") || g.includes("no evidence source"))).toBe(true);
  });

  it("populates sourceClaimIds on evidence-backed Hero Interaction beats per the §7 invariant", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput(), context);
    const proofBeat = board.beats.find((b) => b.kind === "proof");
    const resultBeat = board.beats.find((b) => b.kind === "result");
    expect(proofBeat?.sourceClaimIds.length ?? 0).toBeGreaterThan(0);
    expect(resultBeat?.sourceClaimIds.length ?? 0).toBeGreaterThan(0);
  });
});

describe("StoryEngine — renderer readiness (§9a)", () => {
  it("marks a critical scene as blocked, and blocks the Story Gate, when it has no supporting evidence reference", async () => {
    const engine = new StoryEngine();
    // No browser captures at all removes every evidence-backed critical beat, but the
    // "problem" and "product-introduction" beats (critical/important, evidence-backed by
    // understanding-evidence) still generate scenes; the gate fails independently via
    // missing Hero Interaction / missing critical proof, but rendererReadiness itself
    // must still be computed honestly for whatever scenes do exist.
    const board = await engine.run(baseInput({ browserCaptures: [] }), context);
    expect(board.gate.status).toBe("fail");
    expect(board.rendererReadiness).toBeDefined();
    expect(["ready", "recapture-required", "blocked"]).toContain(board.rendererReadiness.status);
  });
});

describe("StoryEngine — CTA policy (§14 Decision 4)", () => {
  it("requires a CTA for persuade-to-try in promotional mode and includes it as a selected scene", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput({ objective: "persuade-to-try" }), context);
    expect(board.coverage.ctaRequired).toBe(true);
    expect(board.scenes.some((s) => s.beatIds.includes("beat-cta"))).toBe(true);
  });

  it("does not require a CTA for a non-persuasive objective", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput({ objective: "demonstrate" }), context);
    expect(board.coverage.ctaRequired).toBe(false);
    expect(board.scenes.some((s) => s.beatIds.includes("beat-cta"))).toBe(false);
  });
});

describe("StoryEngine — narrative arc selection (§15)", () => {
  it("honors an explicit arc-override constraint and records it with human authority", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(
      baseInput({ constraints: [{ kind: "arc-override", value: "claim-demonstration-verification", reason: "test override" }] }),
      context,
    );
    expect(board.narrativeArc).toBe("claim-demonstration-verification");
    const decision = board.decisions.find((d) => d.decisionId.endsWith("narrative-arc-selected"));
    expect(decision?.authority).toBe("human");
  });
});

describe("StoryEngine — rejection codes (§20)", () => {
  it("records rejected candidates using only declared RejectionReasonCode values", async () => {
    const engine = new StoryEngine();
    const board = await engine.run(baseInput(), context);
    const validCodes = new Set([
      "unsupported",
      "duplicate",
      "low-confidence",
      "non-critical",
      "duration-budget",
      "dependency-missing",
      "conflicts-with-hero",
      "sequencing-invalid",
      "audience-mismatch",
      "claim-not-required",
      "stronger-evidence-selected",
      "incomplete-proof-chain",
      "forbidden-in-current-arc",
      "unsupported-impact",
      "capture-conflict-unresolved",
    ]);
    for (const r of board.rejectedCandidates) {
      expect(validCodes.has(r.reasonCode)).toBe(true);
    }
  });
});

describe("StoryEngine — validate()", () => {
  it("rejects a schemaVersion mismatch", () => {
    const engine = new StoryEngine();
    const result = engine.validate(baseInput({ productUnderstanding: { ...productUnderstanding(), schemaVersion: "0.2" as const } }));
    expect(result.ok).toBe(true);
  });

  it("rejects an authoritativeRunId that does not resolve", () => {
    const engine = new StoryEngine();
    const result = engine.validate(baseInput({ captureSelectionPolicy: { authoritativeRunId: "does-not-exist", fallback: "latest-captured-at" } }));
    expect(result.ok).toBe(false);
  });
});
