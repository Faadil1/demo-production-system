import { describe, expect, it } from "vitest";
import { clampScore, gradeForTotal } from "../src/core/demo-score.js";
import { ExistingDemoAnalysisEngine } from "../src/engines/existing-demo-analysis.js";
import type { MediaInspection } from "../src/core/media-inspection.js";
import type { MediaSource } from "../src/core/media-source.js";
import type { DemoObservation, DemoObservationTimeline } from "../src/core/demo-observation.js";

const context = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };

const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: "./demo.mp4" };

function inspectedMedia(durationSeconds: number): MediaInspection {
  return {
    schemaVersion: "0.1",
    sourceId: source.id,
    status: "inspected",
    containerFormat: "mp4",
    durationSeconds,
    fileSizeBytes: 1024,
    videoStreams: [{ codec: "h264", width: 1920, height: 1080, frameRate: 30, pixelFormat: "yuv420p", durationSeconds }],
    audioStreams: [],
    issues: [],
    provenance: { inspector: "test", inspectorVersion: "0.0.0", sourceType: "capture" },
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

describe("gradeForTotal", () => {
  it.each([
    [100, "excellent"],
    [90, "excellent"],
    [89, "strong"],
    [75, "strong"],
    [74, "adequate"],
    [60, "adequate"],
    [59, "weak"],
    [40, "weak"],
    [39, "insufficient"],
    [0, "insufficient"],
  ] as const)("grades %i as %s", (total, expected) => {
    expect(gradeForTotal(total)).toBe(expected);
  });
});

describe("clampScore", () => {
  it("clamps below zero to zero", () => {
    expect(clampScore(-5, 10)).toBe(0);
  });
  it("clamps above maximum to maximum", () => {
    expect(clampScore(15, 10)).toBe(10);
  });
  it("rounds fractional values", () => {
    expect(clampScore(4.6, 10)).toBe(5);
  });
});

describe("DemoScore via ExistingDemoAnalysisEngine", () => {
  it("has categories that sum to exactly 100 maximum points", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run({ source, mediaInspection: inspectedMedia(30), goal: "prove" }, context);
    const maxSum = analysis.score.categories.reduce((sum, c) => sum + c.maximumPoints, 0);
    expect(maxSum).toBe(100);
    expect(analysis.score.maximum).toBe(100);
  });

  it("produces a low score when there are no observations and no transcript", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run({ source, mediaInspection: inspectedMedia(30) }, context);
    expect(analysis.score.total).toBeLessThan(40);
    expect(analysis.score.grade).toBe("insufficient");
  });

  it("awards more for verified proof than for otherwise-identical unverified evidence", async () => {
    const engine = new ExistingDemoAnalysisEngine();

    const verifiedTimeline = timeline([
      observation({ id: "start", kind: "interaction-start", startSeconds: 0, endSeconds: 2, verificationStatus: "verified" }),
      observation({ id: "complete", kind: "interaction-complete", startSeconds: 2, endSeconds: 4, verificationStatus: "verified" }),
      observation({ id: "proof", kind: "result-visible", startSeconds: 4, endSeconds: 6, verificationStatus: "verified" }),
    ]);
    const unverifiedTimeline = timeline([
      observation({ id: "start", kind: "interaction-start", startSeconds: 0, endSeconds: 2, verificationStatus: "unverified" }),
      observation({ id: "complete", kind: "interaction-complete", startSeconds: 2, endSeconds: 4, verificationStatus: "unverified" }),
      observation({ id: "proof", kind: "result-visible", startSeconds: 4, endSeconds: 6, verificationStatus: "unverified" }),
    ]);

    const verifiedAnalysis = await engine.run(
      { source, mediaInspection: inspectedMedia(30), observationTimeline: verifiedTimeline },
      context,
    );
    const unverifiedAnalysis = await engine.run(
      { source, mediaInspection: inspectedMedia(30), observationTimeline: unverifiedTimeline },
      context,
    );

    expect(verifiedAnalysis.score.total).toBeGreaterThan(unverifiedAnalysis.score.total);
  });

  it("gives a transcript-only demo zero visual-evidence-quality points", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      {
        source,
        mediaInspection: inspectedMedia(30),
        transcript: {
          schemaVersion: "0.1",
          language: "en",
          sourceType: "human",
          segments: [{ id: "t1", startSeconds: 0, endSeconds: 10, text: "We verify the receipt and show the result." }],
        },
      },
      context,
    );
    const evidenceCategory = analysis.score.categories.find((c) => c.id === "evidence-quality");
    expect(evidenceCategory?.awardedPoints).toBe(0);
  });

  it("clamps every category's awardedPoints within [0, maximumPoints]", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const analysis = await engine.run(
      { source, mediaInspection: inspectedMedia(30), observationTimeline: timeline([observation({ id: "o1", kind: "product-ui-visible", startSeconds: 0, endSeconds: 2 })]) },
      context,
    );
    for (const category of analysis.score.categories) {
      expect(category.awardedPoints).toBeGreaterThanOrEqual(0);
      expect(category.awardedPoints).toBeLessThanOrEqual(category.maximumPoints);
    }
  });

  it("is deterministic across repeated runs of identical input", async () => {
    const engine = new ExistingDemoAnalysisEngine();
    const input = {
      source,
      mediaInspection: inspectedMedia(30),
      observationTimeline: timeline([observation({ id: "o1", kind: "product-ui-visible", startSeconds: 0, endSeconds: 2 })]),
    };
    const a = await engine.run(input, context);
    const b = await engine.run(input, context);
    expect(a.score).toEqual(b.score);
  });
});
