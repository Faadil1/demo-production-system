// RFC-0006 §11 — output profile resolution.
import { canonicalHash } from "./render-canonical.js";
import { fromRational } from "./rational.js";
import type { RenderOutputProfile, RenderOutputProfileReference } from "./render.js";
import { DPS_LANDSCAPE_1080P30_V01 } from "./render.js";

export const REGISTERED_OUTPUT_PROFILES: Readonly<Record<string, RenderOutputProfile>> = {
  [DPS_LANDSCAPE_1080P30_V01.id]: DPS_LANDSCAPE_1080P30_V01,
};

export type ProfileResolution =
  | { readonly ok: true; readonly profile: RenderOutputProfile; readonly hash: string }
  | { readonly ok: false; readonly reasonCode: "OUTPUT_PROFILE_NOT_FOUND" | "OUTPUT_PROFILE_HASH_MISMATCH" | "OUTPUT_PROFILE_INVALID" | "OUTPUT_PROFILE_CONTRADICTORY"; readonly detail: string };

function validateSemantics(profile: RenderOutputProfile): string | null {
  if (profile.widthPx <= 0 || !Number.isFinite(profile.widthPx)) return "widthPx MUST be a positive finite number.";
  if (profile.heightPx <= 0 || !Number.isFinite(profile.heightPx)) return "heightPx MUST be a positive finite number.";
  if (profile.pixelAspectRatio.numerator <= 0 || profile.pixelAspectRatio.denominator <= 0) {
    return "pixelAspectRatio MUST have positive numerator and denominator.";
  }
  if (profile.frameRate.kind === "integer" && profile.frameRate.framesPerSecond <= 0) {
    return "frameRate.framesPerSecond MUST be positive.";
  }
  if (profile.frameRate.kind === "rational" && (profile.frameRate.numerator <= 0 || profile.frameRate.denominator <= 0)) {
    return "frameRate numerator/denominator MUST be positive.";
  }
  const insets = profile.safeAreaInsetsPx;
  if (insets.top < 0 || insets.right < 0 || insets.bottom < 0 || insets.left < 0) {
    return "safeAreaInsetsPx MUST NOT be negative.";
  }
  if (insets.top + insets.bottom >= profile.heightPx || insets.left + insets.right >= profile.widthPx) {
    return "safeAreaInsetsPx leaves no positive safe area within the frame (contradictory geometry).";
  }
  return null;
}

export function resolveOutputProfile(reference: RenderOutputProfileReference): ProfileResolution {
  let profile: RenderOutputProfile;

  if (reference.kind === "registered") {
    const found = REGISTERED_OUTPUT_PROFILES[reference.profileArtifactId];
    if (!found) {
      return { ok: false, reasonCode: "OUTPUT_PROFILE_NOT_FOUND", detail: `No registered profile "${reference.profileArtifactId}".` };
    }
    const hash = canonicalHash(found);
    if (hash !== reference.expectedContentHash) {
      return { ok: false, reasonCode: "OUTPUT_PROFILE_HASH_MISMATCH", detail: `Expected hash ${reference.expectedContentHash}, computed ${hash}.` };
    }
    profile = found;
  } else {
    profile = reference.profile;
  }

  const semanticError = validateSemantics(profile);
  if (semanticError) {
    const kind = semanticError.includes("contradictory") ? "OUTPUT_PROFILE_CONTRADICTORY" : "OUTPUT_PROFILE_INVALID";
    return { ok: false, reasonCode: kind, detail: semanticError };
  }

  // reduce rationals for the returned snapshot (normalizes e.g. 2/2 -> 1/1).
  const reducedPar = fromRational(profile.pixelAspectRatio);
  const normalizedProfile: RenderOutputProfile = {
    ...profile,
    pixelAspectRatio: { numerator: Number(reducedPar.numerator), denominator: Number(reducedPar.denominator) },
  };

  return { ok: true, profile: normalizedProfile, hash: canonicalHash(normalizedProfile) };
}
