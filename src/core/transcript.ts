import type { ValidationResult } from "./types.js";

export type TranscriptSourceType = "human" | "caption-file" | "speech-to-text" | "unknown";

export type TranscriptSegment = {
  readonly id: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly speaker?: string;
  readonly confidence?: number;
};

export type Transcript = {
  readonly schemaVersion: "0.1";
  readonly language: string | null;
  readonly sourceType: TranscriptSourceType;
  readonly segments: readonly TranscriptSegment[];
};

/** Tolerance for a transcript segment extending past the media's known duration. */
export const TRANSCRIPT_DURATION_TOLERANCE_SECONDS = 1;

/**
 * A transcript is not proof that the product visibly demonstrated something (RFC-0003
 * Core Principle 3/4) — this validates only the transcript's own internal structure and
 * its consistency with a known media duration, never anything about visual content.
 *
 * Overlapping segments (e.g. two speakers talking over each other) are explicitly
 * ALLOWED as long as segments remain sorted by `startSeconds`; only non-increasing
 * ordering of `startSeconds` is rejected.
 */
export function validateTranscript(
  transcript: Transcript,
  knownDurationSeconds: number | null,
): ValidationResult {
  const issues: { path: string; code: string; message: string }[] = [];

  let previousStart = -Infinity;
  transcript.segments.forEach((segment, index) => {
    const p = `segments/${index}`;
    if (segment.startSeconds < 0) {
      issues.push({ path: `${p}/startSeconds`, code: "negative-start", message: "startSeconds must be >= 0." });
    }
    if (segment.endSeconds <= segment.startSeconds) {
      issues.push({
        path: `${p}/endSeconds`,
        code: "non-positive-duration",
        message: "endSeconds must be greater than startSeconds.",
      });
    }
    if (!segment.text.trim()) {
      issues.push({ path: `${p}/text`, code: "empty-text", message: "Segment text must not be empty." });
    }
    if (segment.confidence !== undefined && (segment.confidence < 0 || segment.confidence > 1)) {
      issues.push({
        path: `${p}/confidence`,
        code: "confidence-out-of-range",
        message: "confidence must be between 0 and 1.",
      });
    }
    if (segment.startSeconds < previousStart) {
      issues.push({
        path: `${p}/startSeconds`,
        code: "out-of-order",
        message: "Segments must be sorted by non-decreasing startSeconds.",
      });
    }
    previousStart = segment.startSeconds;
  });

  if (knownDurationSeconds !== null) {
    const maxEnd = transcript.segments.reduce((max, segment) => Math.max(max, segment.endSeconds), 0);
    if (maxEnd > knownDurationSeconds + TRANSCRIPT_DURATION_TOLERANCE_SECONDS) {
      issues.push({
        path: "segments",
        code: "exceeds-media-duration",
        message: `Transcript extends to ${maxEnd}s, beyond the media duration of ${knownDurationSeconds}s (tolerance ${TRANSCRIPT_DURATION_TOLERANCE_SECONDS}s).`,
      });
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
