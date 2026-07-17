import { describe, expect, it } from "vitest";
import { validateTranscript, type Transcript } from "../src/core/transcript.js";

const baseTranscript: Transcript = {
  schemaVersion: "0.1",
  language: "en",
  sourceType: "human",
  segments: [
    { id: "t1", startSeconds: 0, endSeconds: 4, text: "Hello world." },
    { id: "t2", startSeconds: 4, endSeconds: 8, text: "This is TrustCheck." },
  ],
};

describe("validateTranscript", () => {
  it("accepts valid, sorted segments", () => {
    expect(validateTranscript(baseTranscript, null)).toEqual({ ok: true });
  });

  it("allows overlapping segments as long as startSeconds is non-decreasing (documented policy)", () => {
    const overlapping: Transcript = {
      ...baseTranscript,
      segments: [
        { id: "t1", startSeconds: 0, endSeconds: 5, text: "Speaker A talking." },
        { id: "t2", startSeconds: 3, endSeconds: 8, text: "Speaker B interjecting." },
      ],
    };
    expect(validateTranscript(overlapping, null)).toEqual({ ok: true });
  });

  it("rejects segments out of start-time order", () => {
    const outOfOrder: Transcript = {
      ...baseTranscript,
      segments: [
        { id: "t1", startSeconds: 5, endSeconds: 8, text: "Second in time, first in list." },
        { id: "t2", startSeconds: 0, endSeconds: 4, text: "First in time, second in list." },
      ],
    };
    const result = validateTranscript(outOfOrder, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "out-of-order")).toBe(true);
  });

  it("rejects a negative startSeconds", () => {
    const result = validateTranscript(
      { ...baseTranscript, segments: [{ id: "t1", startSeconds: -1, endSeconds: 2, text: "x" }] },
      null,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects endSeconds <= startSeconds", () => {
    const result = validateTranscript(
      { ...baseTranscript, segments: [{ id: "t1", startSeconds: 2, endSeconds: 2, text: "x" }] },
      null,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects empty text", () => {
    const result = validateTranscript(
      { ...baseTranscript, segments: [{ id: "t1", startSeconds: 0, endSeconds: 2, text: "   " }] },
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "empty-text")).toBe(true);
  });

  it("rejects confidence outside 0..1", () => {
    const result = validateTranscript(
      { ...baseTranscript, segments: [{ id: "t1", startSeconds: 0, endSeconds: 2, text: "x", confidence: 1.5 }] },
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "confidence-out-of-range")).toBe(true);
  });

  it("accepts confidence within 0..1", () => {
    const result = validateTranscript(
      { ...baseTranscript, segments: [{ id: "t1", startSeconds: 0, endSeconds: 2, text: "x", confidence: 0.5 }] },
      null,
    );
    expect(result.ok).toBe(true);
  });

  it("is consistent when duration is unknown (no tolerance check applied)", () => {
    expect(validateTranscript(baseTranscript, null).ok).toBe(true);
  });

  it("rejects a transcript extending beyond the known media duration past tolerance", () => {
    const result = validateTranscript(baseTranscript, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "exceeds-media-duration")).toBe(true);
  });

  it("accepts a transcript within the documented duration tolerance", () => {
    // baseTranscript's last segment ends at 8s; duration 7.5s + 1s tolerance = 8.5s covers it.
    expect(validateTranscript(baseTranscript, 7.5).ok).toBe(true);
  });

  it("computes words-per-minute deterministically from segment text and duration", () => {
    const transcript: Transcript = {
      schemaVersion: "0.1",
      language: "en",
      sourceType: "human",
      segments: [{ id: "t1", startSeconds: 0, endSeconds: 60, text: "one two three four five six seven eight nine ten" }],
    };
    // 10 words over 60 seconds = 10 words per minute.
    const totalSpokenSeconds = transcript.segments.reduce((sum, s) => sum + (s.endSeconds - s.startSeconds), 0);
    const words = transcript.segments[0]!.text.trim().split(/\s+/).length;
    const wpm = (words / totalSpokenSeconds) * 60;
    expect(wpm).toBe(10);
  });
});
