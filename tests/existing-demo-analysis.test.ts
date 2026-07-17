import { describe, expect, it } from "vitest";
import { ExistingDemoAnalysisEngine, type ExistingDemoAnalysisInput } from "../src/engines/existing-demo-analysis.js";
import type { MediaInspection } from "../src/core/media-inspection.js";
import type { MediaSource } from "../src/core/media-source.js";
import type { DemoObservation, DemoObservationTimeline } from "../src/core/demo-observation.js";

const context = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };
const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: "./demo.mp4" };

function inspectedMedia(overrides: Partial<MediaInspection> = {}): MediaInspection {
  return {
    schemaVersion: "0.1",
    sourceId: source.id,
    status: "inspected",
    containerFormat: "mp4",
    durationSeconds: 30,
    fileSizeBytes: 1024,
    videoStreams: [{ codec: "h264", width: 1920, height: 1080, frameRate: 30, pixelFormat: "yuv420p", durationSeconds: 30 }],
    audioStreams: [],
    issues: [],
    provenance: { inspector: "test", inspectorVersion: "0.0.0", sourceType: "capture" },
    ...overrides,
  };
}

function observation(overrides: Partial<DemoObservation> & Pick<DemoObservation, "id" | "kind" | "startSeconds" | "endSeconds">): DemoObservation {
  return {
    statement: "observed",
    sourceType: "human",
    verificationStatus: "unverified",
    confidence: 1,
    relatedEvidenceIds: [],
    ...overrides,
  };
}

function timeline(observations: readonly DemoObservation[]): DemoObservationTimeline {
  return { schemaVersion: "0.1", sourceId: source.id, observations };
}

const heroChain = (verificationStatus: "verified" | "unverified") => [
  observation({ id: "start", kind: "interaction-start", startSeconds: 0, endSeconds: 2, verificationStatus }),
  observation({ id: "complete", kind: "interaction-complete", startSeconds: 2, endSeconds: 4, verificationStatus }),
  observation({ id: "proof", kind: "result-visible", startSeconds: 4, endSeconds: 6, verificationStatus, relatedEvidenceIds: ["ev-1"] }),
];

describe("Hero Interaction detection", () => {
  it("identifies a fully verified sequence", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      { source, mediaInspection: inspectedMedia(), observationTimeline: timeline(heroChain("verified")) },
      context,
    );
    expect(analysis.heroInteraction.status).toBe("identified");
    expect(analysis.heroInteraction.sourceObservationIds).toEqual(["start", "complete", "proof"]);
  });

  it("marks an unverified sequence as candidate-only", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      { source, mediaInspection: inspectedMedia(), observationTimeline: timeline(heroChain("unverified")) },
      context,
    );
    expect(analysis.heroInteraction.status).toBe("candidate-only");
  });

  it("does not identify a Hero Interaction from transcript alone", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        transcript: {
          schemaVersion: "0.1",
          language: "en",
          sourceType: "human",
          segments: [{ id: "t1", startSeconds: 0, endSeconds: 10, text: "Watch us click verify and see the result appear." }],
        },
      },
      context,
    );
    expect(analysis.heroInteraction.status).toBe("not-found");
  });

  it("marks multiple equally strong candidates as ambiguous", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const observations = [
      observation({ id: "start-a", kind: "interaction-start", startSeconds: 0, endSeconds: 1, confidence: 0.8 }),
      observation({ id: "complete-a", kind: "interaction-complete", startSeconds: 1, endSeconds: 2, confidence: 0.8 }),
      observation({ id: "proof-a", kind: "result-visible", startSeconds: 2, endSeconds: 3, confidence: 0.8 }),
      observation({ id: "start-b", kind: "interaction-start", startSeconds: 10, endSeconds: 11, confidence: 0.8 }),
      observation({ id: "complete-b", kind: "interaction-complete", startSeconds: 11, endSeconds: 12, confidence: 0.8 }),
      observation({ id: "proof-b", kind: "result-visible", startSeconds: 12, endSeconds: 13, confidence: 0.8 }),
    ];
    const analysis = await engine.run({ source, mediaInspection: inspectedMedia(), observationTimeline: timeline(observations) }, context);
    expect(analysis.heroInteraction.status).toBe("ambiguous");
  });

  it("reports not-found when there is no candidate at all", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run({ source, mediaInspection: inspectedMedia(), observationTimeline: timeline([]) }, context);
    expect(analysis.heroInteraction.status).toBe("not-found");
  });
});

describe("Evidence analysis", () => {
  it("counts proof-visible observations", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        observationTimeline: timeline([observation({ id: "p1", kind: "proof-visible", startSeconds: 0, endSeconds: 2, verificationStatus: "verified" })]),
      },
      context,
    );
    expect(analysis.evidenceAnalysis.verifiedVisualEvidenceCount).toBe(1);
  });

  it("counts spoken and on-screen claims separately from visual proof", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        observationTimeline: timeline([
          observation({ id: "c1", kind: "claim-spoken", startSeconds: 0, endSeconds: 2, verificationStatus: "verified" }),
          observation({ id: "c2", kind: "claim-on-screen", startSeconds: 2, endSeconds: 4, verificationStatus: "verified" }),
        ]),
      },
      context,
    );
    expect(analysis.evidenceAnalysis.spokenClaimCount).toBe(1);
    expect(analysis.evidenceAnalysis.onScreenClaimCount).toBe(1);
    expect(analysis.evidenceAnalysis.verifiedVisualEvidenceCount).toBe(0);
  });

  it("forces claim-spoken evidence items to unverified even if the observation itself is verified", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        observationTimeline: timeline([observation({ id: "c1", kind: "claim-spoken", startSeconds: 0, endSeconds: 2, verificationStatus: "verified" })]),
      },
      context,
    );
    const spokenItem = analysis.evidenceAnalysis.items.find((item) => item.kind === "claim-spoken");
    expect(spokenItem?.verificationStatus).toBe("unverified");
  });

  it("detects before/after pairs deterministically", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        observationTimeline: timeline([
          observation({ id: "before", kind: "before-state", startSeconds: 0, endSeconds: 2, verificationStatus: "verified" }),
          observation({ id: "after", kind: "after-state", startSeconds: 3, endSeconds: 5, verificationStatus: "verified" }),
        ]),
      },
      context,
    );
    expect(analysis.evidenceAnalysis.beforeAfterPairCount).toBe(1);
    const pairItem = analysis.evidenceAnalysis.items.find((item) => item.kind === "before-after-pair");
    expect(pairItem?.verificationStatus).toBe("verified");
  });

  it("detects unsupported claims (no relatedEvidenceIds)", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        observationTimeline: timeline([observation({ id: "c1", kind: "claim-on-screen", startSeconds: 0, endSeconds: 2, relatedEvidenceIds: [] })]),
      },
      context,
    );
    expect(analysis.evidenceAnalysis.unsupportedClaimCount).toBe(1);
  });

  it("calculates verified proof coverage ratio correctly", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        observationTimeline: timeline([
          observation({ id: "p1", kind: "proof-visible", startSeconds: 0, endSeconds: 2, verificationStatus: "verified" }),
          observation({ id: "p2", kind: "proof-visible", startSeconds: 2, endSeconds: 4, verificationStatus: "unverified" }),
        ]),
      },
      context,
    );
    expect(analysis.evidenceAnalysis.proofCoverageRatio).toBe(0.5);
  });
});

describe("Existing Demo Analysis Gate", () => {
  it("passes for a fully verified, complete analysis with a transcript", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(),
        transcript: {
          schemaVersion: "0.1",
          language: "en",
          sourceType: "human",
          segments: [{ id: "t1", startSeconds: 0, endSeconds: 6, text: "Verify and see the result." }],
        },
        observationTimeline: timeline(heroChain("verified")),
      },
      context,
    );
    expect(analysis.gate.status).toBe("pass");
  });

  it("is conditional when the Hero Interaction chain exists but evidence is unverified", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      { source, mediaInspection: inspectedMedia(), observationTimeline: timeline(heroChain("unverified")) },
      context,
    );
    expect(analysis.gate.status).toBe("conditional");
  });

  it("fails when media is invalid", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia({ status: "invalid", durationSeconds: null, videoStreams: [], issues: [{ code: "file-missing", message: "missing" }] }),
        observationTimeline: timeline(heroChain("verified")),
      },
      context,
    );
    expect(analysis.gate.status).toBe("fail");
  });

  it("fails when there is no usable video stream", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      { source, mediaInspection: inspectedMedia({ videoStreams: [] }), observationTimeline: timeline(heroChain("verified")) },
      context,
    );
    expect(analysis.gate.status).toBe("fail");
  });

  it("fails when there are no usable inputs at all (no transcript, no observations)", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run({ source, mediaInspection: inspectedMedia() }, context);
    expect(analysis.gate.status).toBe("fail");
  });
});

describe("Provenance and confidence invariants", () => {
  it("never represents unverified evidence as proven", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      { source, mediaInspection: inspectedMedia(), observationTimeline: timeline(heroChain("unverified")) },
      context,
    );
    expect(analysis.evidenceAnalysis.verifiedVisualEvidenceCount).toBe(0);
  });

  it("keeps all confidence values within [0, 1]", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      { source, mediaInspection: inspectedMedia(), observationTimeline: timeline(heroChain("verified")) },
      context,
    );
    expect(analysis.heroInteraction.confidence).toBeGreaterThanOrEqual(0);
    expect(analysis.heroInteraction.confidence).toBeLessThanOrEqual(1);
    expect(analysis.structure.confidence).toBeGreaterThanOrEqual(0);
    expect(analysis.structure.confidence).toBeLessThanOrEqual(1);
  });

  it("is deterministic across two runs of identical input", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const input: ExistingDemoAnalysisInput = {
      source,
      mediaInspection: inspectedMedia(),
      observationTimeline: timeline(heroChain("verified")),
    };
    const a = await engine.run(input, context);
    const b = await engine.run(input, context);
    expect(a).toEqual(b);
  });

  it("does not mutate its inputs", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const obsTimeline = timeline(heroChain("verified"));
    const snapshot = JSON.stringify(obsTimeline);
    await engine.run({ source, mediaInspection: inspectedMedia(), observationTimeline: obsTimeline }, context);
    expect(JSON.stringify(obsTimeline)).toBe(snapshot);
  });
});
