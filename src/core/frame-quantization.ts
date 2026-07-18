// RFC-0006 §13 — cumulative-half-even quantization policy v0.1.
import type { FrameRate, QuantizedBoundary, RenderTimingManifest } from "./render.js";
import { exactFrames, frameRateToExact, roundHalfToEven, sub, type ExactRational } from "./rational.js";

export type QuantizationScene = { readonly id: string; readonly durationTargetMs: number };

export type QuantizationOutcome =
  | { readonly ok: true; readonly manifest: RenderTimingManifest; readonly frames: readonly { readonly startFrame: number; readonly endFrameExclusive: number; readonly durationFrames: number }[] }
  | { readonly ok: false; readonly zeroFrameSceneIndex: number };

/**
 * Implements the §13 `quantizeScenes` algorithm exactly: cumulative millisecond boundaries
 * are computed first, then each boundary is independently quantized with exact rational
 * arithmetic and half-to-even rounding — never redistributing residual frames and never
 * independently quantizing a scene's own duration.
 */
export function quantizeScenes(scenes: readonly QuantizationScene[], fps: FrameRate): QuantizationOutcome {
  const exactFps = frameRateToExact(fps);
  const cumulativeMs: number[] = [0];
  for (let i = 0; i < scenes.length; i++) {
    cumulativeMs.push(cumulativeMs[i]! + scenes[i]!.durationTargetMs);
  }

  const exact: ExactRational[] = cumulativeMs.map((ms) => exactFrames(ms, exactFps));
  const quantized: bigint[] = exact.map((e) => roundHalfToEven(e));
  const boundaries: QuantizedBoundary[] = exact.map((e, i) => {
    const delta = sub({ numerator: quantized[i]!, denominator: 1n }, e);
    return {
      index: i,
      exactNumerator: Number(e.numerator),
      exactDenominator: Number(e.denominator),
      quantizedFrame: Number(quantized[i]!),
      deltaNumerator: Number(delta.numerator),
      deltaDenominator: Number(delta.denominator),
    };
  });

  // require quantized[0] == 0 — guaranteed since cumulativeMs[0] === 0.
  const totalFrames = Number(quantized[quantized.length - 1]!);

  const frames: { startFrame: number; endFrameExclusive: number; durationFrames: number }[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const start = Number(quantized[i]!);
    const endExclusive = Number(quantized[i + 1]!);
    const duration = endExclusive - start;
    if (duration <= 0) {
      return { ok: false, zeroFrameSceneIndex: i };
    }
    frames.push({ startFrame: start, endFrameExclusive: endExclusive, durationFrames: duration });
  }

  const manifest: RenderTimingManifest = {
    schemaVersion: "0.1",
    frameRate: fps,
    quantizationPolicy: { id: "cumulative-half-even", version: "0.1" },
    totalNarrativeDurationMs: cumulativeMs[cumulativeMs.length - 1]!,
    totalFrames,
    boundaries,
  };

  return { ok: true, manifest, frames };
}
