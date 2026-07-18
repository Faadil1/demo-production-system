import { describe, expect, it } from "vitest";
import { resolveOutputProfile } from "../src/core/render-profile.js";
import { canonicalHash } from "../src/core/render-canonical.js";
import { DPS_LANDSCAPE_1080P30_V01 } from "../src/core/render.js";

describe("RFC-0006 §11 output profile resolution / Appendix D reference profile", () => {
  it("resolves the registered dps-landscape-1080p30 reference profile with a matching hash", () => {
    const hash = canonicalHash(DPS_LANDSCAPE_1080P30_V01);
    const result = resolveOutputProfile({ kind: "registered", profileArtifactId: "dps-landscape-1080p30", expectedContentHash: hash });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.widthPx).toBe(1920);
    expect(result.profile.heightPx).toBe(1080);
  });

  it("rejects an unknown registered profile id", () => {
    const result = resolveOutputProfile({ kind: "registered", profileArtifactId: "nope", expectedContentHash: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe("OUTPUT_PROFILE_NOT_FOUND");
  });

  it("rejects a hash mismatch on a registered profile", () => {
    const result = resolveOutputProfile({ kind: "registered", profileArtifactId: "dps-landscape-1080p30", expectedContentHash: "wrong" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe("OUTPUT_PROFILE_HASH_MISMATCH");
  });

  it("accepts a semantically valid inline-custom profile and reduces its pixel aspect ratio", () => {
    const result = resolveOutputProfile({
      kind: "inline-custom",
      profile: { ...DPS_LANDSCAPE_1080P30_V01, id: "custom", pixelAspectRatio: { numerator: 2, denominator: 2 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.pixelAspectRatio).toEqual({ numerator: 1, denominator: 1 });
  });

  it("rejects contradictory safe-area geometry", () => {
    const result = resolveOutputProfile({
      kind: "inline-custom",
      profile: { ...DPS_LANDSCAPE_1080P30_V01, safeAreaInsetsPx: { top: 600, bottom: 600, left: 0, right: 0 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe("OUTPUT_PROFILE_CONTRADICTORY");
  });

  it("rejects invalid non-positive dimensions", () => {
    const result = resolveOutputProfile({ kind: "inline-custom", profile: { ...DPS_LANDSCAPE_1080P30_V01, widthPx: 0 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe("OUTPUT_PROFILE_INVALID");
  });
});
