import type { SourceType, VerificationStatus } from "./provenance.js";
import type { ValidationResult } from "./types.js";

export type DemoObservationKind =
  | "product-ui-visible"
  | "interaction-start"
  | "interaction-complete"
  | "state-change"
  | "before-state"
  | "after-state"
  | "proof-visible"
  | "claim-spoken"
  | "claim-on-screen"
  | "problem-context"
  | "result-visible"
  | "call-to-action"
  | "title-card"
  | "transition"
  | "silence"
  | "unknown";

/**
 * An externally supplied observation about a demo video's timeline — from a human
 * reviewer, a future computer-vision adapter, a future browser/capture analyzer, or
 * fixture data. The reference engine never fabricates these; it only consumes and
 * analyzes whatever is supplied. `verificationStatus` is taken at face value and is
 * never promoted upward by the engine (RFC-0003 Core Principle 1 and section 5).
 */
export type DemoObservation = {
  readonly id: string;
  readonly kind: DemoObservationKind;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly statement: string;
  readonly sourceType: SourceType;
  readonly verificationStatus: VerificationStatus;
  readonly confidence: number;
  readonly relatedEvidenceIds: readonly string[];
};

export type DemoObservationTimeline = {
  readonly schemaVersion: "0.1";
  readonly sourceId: string;
  readonly observations: readonly DemoObservation[];
};

/**
 * Structural validation only: chronology, ranges, non-empty statements, confidence
 * bounds, and duplicate IDs. This does NOT decide what counts as visual proof — that
 * policy lives in the ExistingDemoAnalysisEngine's evidence analysis, which explicitly
 * never treats a "claim-spoken" observation as visual evidence regardless of its
 * verificationStatus (RFC-0003 Core Principle 4).
 */
export function validateObservationTimeline(timeline: DemoObservationTimeline): ValidationResult {
  const issues: { path: string; code: string; message: string }[] = [];
  const seenIds = new Set<string>();
  let previousStart = -Infinity;

  timeline.observations.forEach((observation, index) => {
    const p = `observations/${index}`;

    if (seenIds.has(observation.id)) {
      issues.push({ path: `${p}/id`, code: "duplicate-id", message: `Duplicate observation id "${observation.id}".` });
    }
    seenIds.add(observation.id);

    if (observation.startSeconds < 0) {
      issues.push({ path: `${p}/startSeconds`, code: "negative-start", message: "startSeconds must be >= 0." });
    }
    if (observation.endSeconds < observation.startSeconds) {
      issues.push({
        path: `${p}/endSeconds`,
        code: "invalid-range",
        message: "endSeconds must be greater than or equal to startSeconds.",
      });
    }
    if (!observation.statement.trim()) {
      issues.push({ path: `${p}/statement`, code: "empty-statement", message: "Observation statement must not be empty." });
    }
    if (observation.confidence < 0 || observation.confidence > 1) {
      issues.push({
        path: `${p}/confidence`,
        code: "confidence-out-of-range",
        message: "confidence must be between 0 and 1.",
      });
    }
    if (observation.startSeconds < previousStart) {
      issues.push({
        path: `${p}/startSeconds`,
        code: "chronology-violation",
        message: "Observations must be sorted by non-decreasing startSeconds.",
      });
    }
    previousStart = observation.startSeconds;
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
