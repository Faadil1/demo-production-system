import { describe, expect, it } from "vitest";
import { RenderEngine } from "../src/engines/render.js";
import { canonicalHash, canonicalStringify } from "../src/core/render-canonical.js";
import type { Storyboard } from "../src/core/story.js";
import type { RenderAssetCandidateRecord, RenderBindingRequest } from "../src/core/render-input.js";
import {
  buildBundle,
  defaultAdapterCapabilities,
  minimalStoryboard,
  ONE_PX_PNG_BASE64,
  ONE_PX_PNG_HASH,
  ONE_PX_PNG_LENGTH,
  twoSceneStoryboard,
} from "./fixtures/render-fixtures.js";

const context = { runId: "corrections", now: () => new Date("2026-07-17T00:00:00Z") };

function authorizedStoryboard(evidenceRefId = "ev-1"): Storyboard {
  const board = twoSceneStoryboard();
  return {
    ...board,
    scenes: board.scenes.map((scene) =>
      scene.id === "scene-a" ? { ...scene, requiredEvidenceRefs: [evidenceRefId] } : scene,
    ),
  };
}

function binding(evidenceRefId = "ev-1", criticality: "required" | "optional" = "required"): RenderBindingRequest {
  return {
    id: "binding-1",
    storyboardSceneId: "scene-a",
    renderLayerId: "asset-layer",
    evidenceRefId,
    role: "primary",
    criticality,
    acceptableMediaTypes: ["image/png"],
    geometry: { xPx: 200, yPx: 200, widthPx: 400, heightPx: 300 },
    zIndex: 0,
  };
}

function png(overrides: Partial<RenderAssetCandidateRecord> = {}): RenderAssetCandidateRecord {
  return {
    id: "candidate-1",
    evidenceRefId: "ev-1",
    source: { kind: "artifact", sourceArtifactId: "asset-source" },
    declaredMediaType: "image/png",
    bytesBase64: ONE_PX_PNG_BASE64,
    expectedContentHash: ONE_PX_PNG_HASH,
    declaredByteLength: ONE_PX_PNG_LENGTH,
    declaredWidthPx: 1,
    declaredHeightPx: 1,
    ...overrides,
  };
}

describe("RFC-0006 corrective packet", () => {
  it("derives playback from sequence order and sceneIds, not global StoryScene.order", async () => {
    const base = twoSceneStoryboard();
    const storyboard: Storyboard = {
      ...base,
      scenes: [
        { ...base.scenes[0]!, sequenceId: "sequence-b", order: 0 },
        { ...base.scenes[1]!, sequenceId: "sequence-a", order: 99 },
      ],
      sequences: [
        { id: "sequence-b", kind: "outcome", purpose: "b", sceneIds: ["scene-a"], order: 2, durationBudgetMs: 2000, required: true, completionCriteria: [] },
        { id: "sequence-a", kind: "opening", purpose: "a", sceneIds: ["scene-b"], order: 1, durationBudgetMs: 2000, required: true, completionCriteria: [] },
      ],
    };
    const result = await new RenderEngine().run(buildBundle({ storyboard }), context);
    expect(result.kind).toBe("compiled");
    if (result.kind === "compiled") expect(result.plan.scenes.map((scene) => scene.storyboardSceneId)).toEqual(["scene-b", "scene-a"]);
  });

  it.each(["missing", "duplicate", "orphan"] as const)("rejects %s sequence membership", async (mode) => {
    const board = twoSceneStoryboard();
    const ids = mode === "missing" ? ["scene-a", "no-scene"] : mode === "duplicate" ? ["scene-a", "scene-a"] : ["scene-a"];
    const storyboard = { ...board, sequences: [{ ...board.sequences[0]!, sceneIds: ids }] };
    const result = await new RenderEngine().run(buildBundle({ storyboard }), context);
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.rejection.reasonCodes).toContain("STORYBOARD_REFERENCE_INVALID");
  });

  it("rejects an asset binding whose evidence is not authorized by its target scene", async () => {
    const result = await new RenderEngine().run(buildBundle({ storyboard: twoSceneStoryboard(), assetBindingRequests: [binding("ev-forbidden")] }), context);
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.rejection.reasonCodes).toContain("STORYBOARD_REFERENCE_INVALID");
  });

  it.each([
    ["missing bytes", { bytesBase64: undefined }],
    ["invalid base64", { bytesBase64: "%%%%" }],
    ["hash mismatch", { expectedContentHash: "0".repeat(64) }],
    ["length mismatch", { declaredByteLength: ONE_PX_PNG_LENGTH + 1 }],
    ["dimension mismatch", { declaredWidthPx: 2 }],
  ] as const)("excludes candidates with %s", async (_name, overrides) => {
    const result = await new RenderEngine().run(buildBundle({ storyboard: authorizedStoryboard(), assetCandidates: [png(overrides as unknown as Partial<RenderAssetCandidateRecord>)], assetBindingRequests: [binding()] }), context);
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.rejection.reasonCodes.some((code) => code === "ASSET_CORRUPT" || code === "ASSET_HASH_MISMATCH" || code === "ASSET_BINDING_UNRESOLVED")).toBe(true);
  });

  it("records preparation requirements without claiming an unproduced prepared artifact", async () => {
    const result = await new RenderEngine().run(buildBundle({ storyboard: authorizedStoryboard(), assetCandidates: [png()], assetBindingRequests: [binding()] }), context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(result.preparationRequirements.length).toBe(1);
    expect(result.resolvedAssets[0]!.preparedArtifactId).toBeUndefined();
    expect(result.resolvedAssets[0]!.preparedContentHash).toBeUndefined();
  });

  it("keeps one canonical plan unchanged across adapter snapshots and changes only gate evaluation", async () => {
    const storyboard = authorizedStoryboard();
    const common = { storyboard, assetCandidates: [png()], assetBindingRequests: [binding()] };
    const a = await new RenderEngine().run(buildBundle({ ...common, adapterCapabilities: defaultAdapterCapabilities({ supportedMediaTypes: [] }) }), context);
    const b = await new RenderEngine().run(buildBundle({ ...common, adapterCapabilities: defaultAdapterCapabilities() }), context);
    expect(a.kind).toBe("compiled");
    expect(b.kind).toBe("compiled");
    if (a.kind !== "compiled" || b.kind !== "compiled") return;
    expect(canonicalStringify(a.plan)).toBe(canonicalStringify(b.plan));
    expect(a.gate.status).toBe("fail");
    expect(b.gate.status).toBe("pass");
  });

  it("rejects a tampered capability artifact hash before evaluation", async () => {
    const bundle = buildBundle({ storyboard: twoSceneStoryboard() });
    const result = await new RenderEngine().run({ ...bundle, adapterCapabilitiesHash: "tampered" }, context);
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.rejection.reasonCodes).toContain("RENDER_COMPILER_INPUT_INVALID");
  });

  it("preserves approved-variant provenance and never emits full text as overflow evidence", async () => {
    const storyboard = minimalStoryboard([{ ...twoSceneStoryboard().scenes[0]!, title: "A long original title", requiredEvidenceRefs: [] }]);
    const result = await new RenderEngine().run(buildBundle({
      storyboard,
      textLayerRequests: [{
        id: "text-1", storyboardSceneId: "scene-a", sourceField: "title",
        geometry: { xPx: 200, yPx: 200, widthPx: 40, heightPx: 20 }, zIndex: 0,
        criticality: "required", minFontSizePx: 8, maxFontSizePx: 20,
        approvedVariants: [{ id: "variant-1", authoritativePriority: 1, textSourceArtifactId: "approved-text", textSourceItemId: "item-1", text: "Hi" }],
      }],
    }), context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    const layer = result.plan.scenes[0]!.layers.find((item) => item.kind === "text");
    expect(layer?.kind === "text" ? layer.source : null).toEqual({ kind: "approved-variant", auxiliaryArtifactId: "approved-text", variantId: "variant-1" });
    expect(canonicalHash(layer)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("serializes exact rational boundary provenance as lossless decimal strings", async () => {
    const result = await new RenderEngine().run(buildBundle({ storyboard: twoSceneStoryboard(), inputOverrides: { outputProfile: { kind: "inline-custom", profile: { schemaVersion: "0.1", id: "ntsc", version: "1", widthPx: 1920, heightPx: 1080, pixelAspectRatio: { numerator: 1, denominator: 1 }, frameRate: { kind: "rational", numerator: 30000, denominator: 1001 }, colorSpace: "srgb", safeAreaInsetsPx: { top: 0, right: 0, bottom: 0, left: 0 }, audioMode: "none" } } } }), context);
    expect(result.kind).toBe("compiled");
    if (result.kind === "compiled") {
      expect(typeof result.plan.timing.boundaries[1]!.exactNumerator).toBe("string");
      expect(typeof result.plan.timing.boundaries[1]!.exactDenominator).toBe("string");
    }
  });
});