// RFC-0006 §12-13 — exact rational arithmetic and cumulative half-to-even quantization.
// No floating-point value produced here is authoritative; every comparison and rounding
// decision is performed with BigInt numerator/denominator pairs.

import type { FrameRate, Rational } from "./render.js";

export type ExactRational = { readonly numerator: bigint; readonly denominator: bigint };

function bigGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}

/** §12: positive denominator, reduced by GCD, zero represented as 0/1, sign in numerator only. */
export function reduce(numerator: bigint, denominator: bigint): ExactRational {
  if (denominator === 0n) throw new Error("rational denominator MUST NOT be zero");
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return { numerator: 0n, denominator: 1n };
  const g = bigGcd(n, d);
  return { numerator: n / g, denominator: d / g };
}

export function fromRational(r: Rational): ExactRational {
  return reduce(BigInt(r.numerator), BigInt(r.denominator));
}

export function toRational(r: ExactRational): Rational {
  return { numerator: Number(r.numerator), denominator: Number(r.denominator) };
}

/** Normalizes any FrameRate to an exact fps/1 or numerator/denominator rational (§11). */
export function frameRateToExact(rate: FrameRate): ExactRational {
  if (rate.kind === "integer") return reduce(BigInt(rate.framesPerSecond), 1n);
  return reduce(BigInt(rate.numerator), BigInt(rate.denominator));
}

export function add(a: ExactRational, b: ExactRational): ExactRational {
  return reduce(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

export function sub(a: ExactRational, b: ExactRational): ExactRational {
  return reduce(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
}

export function mul(a: ExactRational, b: ExactRational): ExactRational {
  return reduce(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function compare(a: ExactRational, b: ExactRational): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isZero(a: ExactRational): boolean {
  return a.numerator === 0n;
}

/**
 * §12: exactFrames(d) = d * p / (1000 * q) for duration `d` ms and rate p/q fps.
 */
export function exactFrames(durationMs: number, fps: ExactRational): ExactRational {
  return reduce(BigInt(durationMs) * fps.numerator, 1000n * fps.denominator);
}

/**
 * Exact half-to-even ("banker's rounding") of a rational to the nearest integer, computed
 * entirely with BigInt so no floating-point representation error can influence a tie
 * decision. Returns the integer frame count as a bigint.
 */
export function roundHalfToEven(value: ExactRational): bigint {
  const n = value.numerator;
  const d = value.denominator;
  // floor division that rounds toward -infinity
  let q = n / d;
  let r = n % d;
  if (r < 0n) {
    q -= 1n;
    r += d;
  }
  // r/d is the fractional remainder in [0, 1)
  const twiceR = r * 2n;
  if (twiceR < d) return q;
  if (twiceR > d) return q + 1n;
  // exact tie: round to even
  return q % 2n === 0n ? q : q + 1n;
}
