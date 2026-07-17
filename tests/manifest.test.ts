import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/core/manifest.js";

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateManifest({
      schemaVersion: "0.1",
      project: { name: "TrustCheck" },
      product: {
        problem: "Agents cannot verify actions.",
        audience: ["judges"],
        valueProposition: "Signed receipts.",
      },
      demo: {
        goal: "prove",
        audience: "technical judges",
        durationSeconds: 60,
        mode: "directed",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a manifest missing required top-level sections", () => {
    const result = validateManifest({
      schemaVersion: "0.1",
      project: { name: "X" },
      demo: { goal: "prove", audience: "a", durationSeconds: 5, mode: "directed" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown schemaVersion", () => {
    const result = validateManifest({
      schemaVersion: "9.9",
      project: { name: "X" },
      product: { problem: "p", audience: ["a"], valueProposition: "v" },
      demo: { goal: "prove", audience: "a", durationSeconds: 60, mode: "directed" },
    });
    expect(result.ok).toBe(false);
  });
});
