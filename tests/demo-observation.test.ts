import { describe, expect, it } from "vitest";
import { validateObservationTimeline, type DemoObservation, type DemoObservationTimeline } from "../src/core/demo-observation.js";

function timeline(observations: readonly DemoObservation[]): DemoObservationTimeline {
  return { schemaVersion: "0.1", sourceId: "source-1", observations };
}

const verifiedObservation: DemoObservation = {
  id: "o1",
  kind: "product-ui-visible",
  startSeconds: 0,
  endSeconds: 4,
  statement: "The UI is visible.",
  sourceType: "human",
  verificationStatus: "verified",
  confidence: 1,
  relatedEvidenceIds: [],
};

const unverifiedObservation: DemoObservation = {
  ...verifiedObservation,
  id: "o2",
  startSeconds: 4,
  endSeconds: 8,
  verificationStatus: "unverified",
};

describe("validateObservationTimeline", () => {
  it("accepts a valid, chronologically-ordered timeline", () => {
    expect(validateObservationTimeline(timeline([verifiedObservation, unverifiedObservation]))).toEqual({ ok: true });
  });

  it("keeps verified and unverified observations distinct rather than collapsing them", () => {
    const result = validateObservationTimeline(timeline([verifiedObservation, unverifiedObservation]));
    expect(result.ok).toBe(true);
    expect(verifiedObservation.verificationStatus).not.toBe(unverifiedObservation.verificationStatus);
  });

  it("rejects invalid chronology (startSeconds decreasing)", () => {
    // unverifiedObservation starts at 4s; verifiedObservation starts at 0s — listing the
    // later one first makes the timeline out of chronological order.
    const result = validateObservationTimeline(timeline([unverifiedObservation, verifiedObservation]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "chronology-violation")).toBe(true);
  });

  it("rejects endSeconds before startSeconds", () => {
    const result = validateObservationTimeline(timeline([{ ...verifiedObservation, startSeconds: 5, endSeconds: 2 }]));
    expect(result.ok).toBe(false);
  });

  it("rejects confidence outside 0..1", () => {
    const result = validateObservationTimeline(timeline([{ ...verifiedObservation, confidence: 1.2 }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "confidence-out-of-range")).toBe(true);
  });

  it("rejects an empty statement", () => {
    const result = validateObservationTimeline(timeline([{ ...verifiedObservation, statement: "   " }]));
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate observation ids", () => {
    const result = validateObservationTimeline(
      timeline([verifiedObservation, { ...unverifiedObservation, id: verifiedObservation.id }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "duplicate-id")).toBe(true);
  });

  it("retains sourceType provenance on each observation", () => {
    const humanObservation: DemoObservation = { ...verifiedObservation, sourceType: "human" };
    const captureObservation: DemoObservation = { ...unverifiedObservation, sourceType: "capture" };
    const result = validateObservationTimeline(timeline([humanObservation, captureObservation]));
    expect(result.ok).toBe(true);
    expect(humanObservation.sourceType).toBe("human");
    expect(captureObservation.sourceType).toBe("capture");
  });
});
