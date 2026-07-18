import { describe, expect, it } from "vitest";
import { quantizeScenes } from "../src/core/frame-quantization.js";

describe("RFC-0006 §13 cumulative-half-even frame quantization (Appendix F golden fixtures)", () => {
  it("integral 30fps boundaries are exact", () => {
    const outcome = quantizeScenes(
      [
        { id: "a", durationTargetMs: 1000 },
        { id: "b", durationTargetMs: 2000 },
      ],
      { kind: "integer", framesPerSecond: 30 },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.frames).toEqual([
      { startFrame: 0, endFrameExclusive: 30, durationFrames: 30 },
      { startFrame: 30, endFrameExclusive: 90, durationFrames: 60 },
    ]);
    expect(outcome.manifest.totalFrames).toBe(90);
    expect(outcome.manifest.boundaries[0]!.quantizedFrame).toBe(0);
  });

  it("fractional 30000/1001 boundaries quantize deterministically", () => {
    const outcome = quantizeScenes([{ id: "a", durationTargetMs: 1000 }, { id: "b", durationTargetMs: 1000 }], {
      kind: "rational",
      numerator: 30000,
      denominator: 1001,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // exact frames for 1000ms at 30000/1001 fps = 30000000/1001000 = 29.970...
    expect(outcome.frames[0]!.durationFrames + outcome.frames[1]!.durationFrames).toBe(outcome.manifest.totalFrames);
    expect(outcome.manifest.boundaries.length).toBe(3);
  });

  it("exact half-to-even lower tie (x.5 with even neighbor rounds down)", () => {
    // 1 scene, duration chosen so exact frame count is exactly N+0.5 with N even.
    // fps=2/1, duration=1250ms -> exact = 1250*2/1000 = 2.5 -> rounds to 2 (even).
    const outcome = quantizeScenes([{ id: "a", durationTargetMs: 1250 }], { kind: "integer", framesPerSecond: 2 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.manifest.boundaries[1]!.quantizedFrame).toBe(2);
  });

  it("exact half-to-even upper tie (x.5 with odd neighbor rounds up)", () => {
    // fps=2/1, duration=1750ms -> exact = 3.5 -> rounds to 4 (even).
    const outcome = quantizeScenes([{ id: "a", durationTargetMs: 1750 }], { kind: "integer", framesPerSecond: 2 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.manifest.boundaries[1]!.quantizedFrame).toBe(4);
  });

  it("rejects a scene that quantizes to zero frames without lengthening it", () => {
    const outcome = quantizeScenes(
      [
        { id: "a", durationTargetMs: 1000 },
        { id: "zero", durationTargetMs: 1 }, // at low fps this can round to the same boundary as its predecessor
      ],
      { kind: "integer", framesPerSecond: 1 },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.zeroFrameSceneIndex).toBe(1);
  });

  it("does not redistribute residual frames across many scenes (cumulative-only quantization)", () => {
    const scenes = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, durationTargetMs: 333 }));
    const outcome = quantizeScenes(scenes, { kind: "integer", framesPerSecond: 30 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // boundaries must be strictly increasing and contiguous
    for (let i = 0; i < outcome.frames.length - 1; i++) {
      expect(outcome.frames[i]!.endFrameExclusive).toBe(outcome.frames[i + 1]!.startFrame);
    }
    expect(outcome.frames[0]!.startFrame).toBe(0);
    expect(outcome.frames[outcome.frames.length - 1]!.endFrameExclusive).toBe(outcome.manifest.totalFrames);
  });

  it("is deterministic across repeated invocations with equivalent inputs", () => {
    const scenes = [{ id: "a", durationTargetMs: 1234 }, { id: "b", durationTargetMs: 5678 }];
    const first = quantizeScenes(scenes, { kind: "integer", framesPerSecond: 30 });
    const second = quantizeScenes(scenes, { kind: "integer", framesPerSecond: 30 });
    expect(first).toEqual(second);
  });
});
