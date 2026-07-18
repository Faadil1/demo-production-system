import { describe, expect, it } from "vitest";
import { add, compare, exactFrames, frameRateToExact, mul, reduce, roundHalfToEven, sub } from "../src/core/rational.js";

describe("RFC-0006 §12 exact rational arithmetic", () => {
  it("reduces by gcd and normalizes sign into the numerator", () => {
    expect(reduce(4n, 8n)).toEqual({ numerator: 1n, denominator: 2n });
    expect(reduce(-4n, 8n)).toEqual({ numerator: -1n, denominator: 2n });
    expect(reduce(4n, -8n)).toEqual({ numerator: -1n, denominator: 2n });
    expect(reduce(0n, 5n)).toEqual({ numerator: 0n, denominator: 1n });
  });

  it("throws on zero denominator", () => {
    expect(() => reduce(1n, 0n)).toThrow();
  });

  it("add/sub/mul are exact", () => {
    const a = reduce(1n, 3n);
    const b = reduce(1n, 6n);
    expect(add(a, b)).toEqual(reduce(1n, 2n));
    expect(sub(a, b)).toEqual(reduce(1n, 6n));
    expect(mul(a, b)).toEqual(reduce(1n, 18n));
  });

  it("compares exactly without floating point", () => {
    expect(compare(reduce(1n, 3n), reduce(1n, 3n))).toBe(0);
    expect(compare(reduce(1n, 3n), reduce(2n, 3n))).toBe(-1);
    expect(compare(reduce(2n, 3n), reduce(1n, 3n))).toBe(1);
  });

  it("frameRateToExact normalizes integer fps to fps/1", () => {
    expect(frameRateToExact({ kind: "integer", framesPerSecond: 30 })).toEqual({ numerator: 30n, denominator: 1n });
    expect(frameRateToExact({ kind: "rational", numerator: 30000, denominator: 1001 })).toEqual(reduce(30000n, 1001n));
  });

  it("exactFrames computes d*p/(1000*q)", () => {
    const fps = frameRateToExact({ kind: "integer", framesPerSecond: 30 });
    expect(exactFrames(1000, fps)).toEqual(reduce(30n, 1n));
    expect(exactFrames(500, fps)).toEqual(reduce(15n, 1n));
  });

  describe("roundHalfToEven", () => {
    it("rounds down below .5", () => {
      expect(roundHalfToEven(reduce(9n, 4n))).toBe(2n); // 2.25 -> 2
    });
    it("rounds exact ties to even — lower tie", () => {
      expect(roundHalfToEven(reduce(5n, 2n))).toBe(2n); // 2.5 -> 2 (even)
    });
    it("rounds exact ties to even — upper tie", () => {
      expect(roundHalfToEven(reduce(7n, 2n))).toBe(4n); // 3.5 -> 4 (even)
    });
    it("rounds non-tie values to nearest", () => {
      expect(roundHalfToEven(reduce(11n, 4n))).toBe(3n); // 2.75 -> 3
      expect(roundHalfToEven(reduce(9n, 4n))).toBe(2n); // 2.25 -> 2
    });
    it("handles negative values via floor-based half-even", () => {
      expect(roundHalfToEven(reduce(-5n, 2n))).toBe(-2n); // -2.5 -> -2 (even)
    });
  });
});
