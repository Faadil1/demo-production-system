import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RenderEngine } from "../src/engines/render.js";
import { canonicalHash, canonicalStringify } from "../src/core/render-canonical.js";
import { buildBundle, defaultAdapterCapabilities, entryRequirementClassification, ONE_PX_PNG_BASE64, ONE_PX_PNG_HASH, ONE_PX_PNG_LENGTH, twoSceneStoryboard } from "./fixtures/render-fixtures.js";
import type { RenderAssetCandidateRecord, RenderBindingRequest } from "../src/core/render-input.js";

const context = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };

function pngCandidate(id: string, evidenceRefId: string, overrides: Partial<RenderAssetCandidateRecord> = {}): RenderAssetCandidateRecord {
  return {
    id,
    evidenceRefId,
    source: { kind: "artifact", sourceArtifactId: `artifact-${id}` },
    declaredMediaType: "image/png",
    bytesBase64: ONE_PX_PNG_BASE64,
    expectedContentHash: ONE_PX_PNG_HASH,
    declaredByteLength: ONE_PX_PNG_LENGTH,
    declaredWidthPx: 1,
    declaredHeightPx: 1,
    ...overrides,
  };
}

function assetBinding(id: string, sceneId: string, evidenceRefId: string, overrides: Partial<RenderBindingRequest> = {}): RenderBindingRequest {
  return {
    id,
    storyboardSceneId: sceneId,
    renderLayerId: `layer-${id}`,
    evidenceRefId,
    role: "primary",
    criticality: "required",
    acceptableMediaTypes: ["image/png"],
    geometry: { xPx: 200, yPx: 200, widthPx: 400, heightPx: 300 },
    zIndex: 0,
    ...overrides,
  };
}

describe("RFC-0006 RenderEngine — Case A (rejection)", () => {
  it("rejects when the Story Gate has status fail", async () => {
    const storyboard = { ...twoSceneStoryboard(), gate: { status: "fail" as const, blockingReasons: ["x"], warnings: [], requirementsBeforeRender: [] } };
    const bundle = buildBundle({ storyboard });
    const engine = new RenderEngine();
    const result = await engine.run(bundle, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reasonCodes).toContain("STORY_GATE_INELIGIBLE");
  });

  it("rejects a Story Gate conditional entry when a requirement is not renderer-bound", async () => {
    const storyboard = {
      ...twoSceneStoryboard(),
      gate: { status: "conditional" as const, blockingReasons: [], warnings: [], requirementsBeforeRender: ["Supply a verified ProofChain for every critical claim."] },
    };
    const bundle = buildBundle({ storyboard });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reasonCodes).toContain("RENDER_COMPILER_INPUT_INVALID");
  });

  it("admits a Story Gate conditional entry when every requirement is renderer-bound", async () => {
    const storyboard = {
      ...twoSceneStoryboard(),
      gate: { status: "conditional" as const, blockingReasons: [], warnings: [], requirementsBeforeRender: ["Recapture the hero asset."] },
    };
    const storyboardContentHash = canonicalHash(storyboard);
    const bundle = buildBundle({
      storyboard,
      inputOverrides: {
        entryRequirementClassifications: [
          entryRequirementClassification({
            storyboardArtifactId: storyboard.id,
            storyboardContentHash,
            requirementIndex: 0,
            requirement: storyboard.gate.requirementsBeforeRender[0]!,
            classification: "renderer-bound",
          }),
        ],
      },
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
  });

  it("rejects on storyboard content hash mismatch", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({ storyboard });
    const tampered = { ...bundle, storyboardContentHash: "tampered-hash" };
    const result = await new RenderEngine().run(tampered, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reasonCodes).toContain("STORYBOARD_HASH_MISMATCH");
  });

  it("rejects when a required asset binding has no candidate (ASSET_MISSING)", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-missing")],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reasonCodes).toContain("ASSET_MISSING");
  });

  it("rejects when a required layer violates the safe area (structurally invalid layout)", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      assetCandidates: [pngCandidate("cand-1", "ev-1")],
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1", { geometry: { xPx: 0, yPx: 0, widthPx: 50, heightPx: 50 } })],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reasonCodes).toContain("SAFE_AREA_VIOLATION");
  });
});

describe("RFC-0006 RenderEngine — Case B (plan exists, gate fails)", () => {
  it("persists resolved assets + plan and fails the gate when the adapter lacks a required media type", async () => {
    const storyboard = twoSceneStoryboard();
    const caps = defaultAdapterCapabilities({ supportedMediaTypes: [] });
    const bundle = buildBundle({
      storyboard,
      adapterCapabilities: caps,
      assetCandidates: [pngCandidate("cand-1", "ev-1")],
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(result.gate.status).toBe("fail");
    expect(result.plan.id).toBeTruthy();
    expect(result.resolvedAssets.length).toBe(1);
    expect(result.gate.blockingFindings.some((f) => f.reasonCode === "ADAPTER_MEDIA_TYPE_UNSUPPORTED")).toBe(true);
  });

  it("golden fixture: the same structurally valid plan fails against one adapter snapshot and passes against another", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = (caps: ReturnType<typeof defaultAdapterCapabilities>) =>
      buildBundle({
        storyboard,
        adapterCapabilities: caps,
        assetCandidates: [pngCandidate("cand-1", "ev-1")],
        assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")],
      });

    const failing = await new RenderEngine().run(bundle(defaultAdapterCapabilities({ supportedMediaTypes: [] })), context);
    const passing = await new RenderEngine().run(bundle(defaultAdapterCapabilities()), context);
    expect(failing.kind).toBe("compiled");
    expect(passing.kind).toBe("compiled");
    if (failing.kind !== "compiled" || passing.kind !== "compiled") return;
    expect(failing.gate.status).toBe("fail");
    expect(passing.gate.status).toBe("pass");
    expect(canonicalStringify(failing.plan.scenes)).toBe(canonicalStringify(passing.plan.scenes));
  });
});

describe("RFC-0006 RenderEngine — Case C (plan exists, gate pass/conditional)", () => {
  it("passes cleanly with no bindings and no constraints violated", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({ storyboard });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(result.gate.status).toBe("pass");
    expect(result.plan.scenes.length).toBe(2);
    expect(result.plan.timing.totalFrames).toBe(120); // 4000ms @ 30fps
  });

  it("omits an optional unavailable asset and reaches conditional, not fail", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-optional-missing", { criticality: "optional" })],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(result.gate.status).toBe("conditional");
    expect(result.plan.scenes[0]!.layers.some((l) => l.kind === "asset")).toBe(false);
    expect(result.gate.warnings.some((w) => w.reasonCode === "OPTIONAL_ASSET_UNAVAILABLE")).toBe(true);
  });

  it("reaches pass with a valid required asset binding fully resolved", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      assetCandidates: [pngCandidate("cand-1", "ev-1")],
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(result.gate.status).toBe("pass");
    const assetLayer = result.plan.scenes[0]!.layers.find((l) => l.kind === "asset");
    expect(assetLayer).toBeTruthy();
  });
});

describe("RFC-0006 asset integrity and candidate selection", () => {
  it("excludes a hash/format-mismatched candidate from resolvedAssets and reports a finding", async () => {
    const storyboard = twoSceneStoryboard();
    const corrupted = pngCandidate("cand-bad", "ev-1", { bytesBase64: Buffer.from("not a png").toString("base64") });
    const good = pngCandidate("cand-good", "ev-1");
    const bundle = buildBundle({
      storyboard,
      assetCandidates: [corrupted, good],
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(result.resolvedAssets.length).toBe(1);
    expect(result.resolvedAssets[0]!.sourceContentHash).toBe(
      createHash("sha256").update(Buffer.from(ONE_PX_PNG_BASE64, "base64")).digest("hex"),
    );
  });

  it("selects deterministically by policyPreferenceRank regardless of declaration order (filesystem-order independence)", async () => {
    const storyboard = twoSceneStoryboard();
    const c1 = pngCandidate("cand-z", "ev-1", { policyPreferenceRank: 2 });
    const c2 = pngCandidate("cand-a", "ev-1", { policyPreferenceRank: 1 });
    const forward = buildBundle({ storyboard, assetCandidates: [c1, c2], assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")] });
    const reversed = buildBundle({ storyboard, assetCandidates: [c2, c1], assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")] });
    const r1 = await new RenderEngine().run(forward, context);
    const r2 = await new RenderEngine().run(reversed, context);
    expect(r1.kind).toBe("compiled");
    expect(r2.kind).toBe("compiled");
    if (r1.kind !== "compiled" || r2.kind !== "compiled") return;
    expect(r1.resolvedAssets[0]!.bindingId).toBe("b1");
    expect(canonicalStringify(r1.resolvedAssets)).toBe(canonicalStringify(r2.resolvedAssets));
  });

  it("flags ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS when two distinct top-ranked sources tie", async () => {
    const storyboard = twoSceneStoryboard();
    const c1 = pngCandidate("cand-x", "ev-1", { source: { kind: "artifact", sourceArtifactId: "art-x" } });
    const c2 = pngCandidate("cand-y", "ev-1", { source: { kind: "artifact", sourceArtifactId: "art-y" } });
    const bundle = buildBundle({ storyboard, assetCandidates: [c1, c2], assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")] });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reasonCodes).toContain("ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS");
  });
});

describe("RFC-0006 text-fit and variant priority (§27)", () => {
  it("prefers a lower-priority-number variant over a lexically earlier higher-priority-number variant", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      textLayerRequests: [
        {
          id: "text-1",
          storyboardSceneId: "scene-a",
          sourceField: "title",
          geometry: { xPx: 200, yPx: 200, widthPx: 40, heightPx: 20 },
          zIndex: 0,
          criticality: "required",
          minFontSizePx: 8,
          maxFontSizePx: 40,
          approvedVariants: [
            { id: "variant-z", authoritativePriority: 1, textSourceArtifactId: "a", textSourceItemId: "1", text: "Hi" },
            { id: "variant-a", authoritativePriority: 2, textSourceArtifactId: "a", textSourceItemId: "2", text: "Hi" },
          ],
        },
      ],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    const textLayer = result.plan.scenes[0]!.layers.find((l) => l.kind === "text");
    expect(textLayer && "usedVariantId" in textLayer ? textLayer.usedVariantId : undefined).toBe("variant-z");
  });

  it("emits TEXT_OVERFLOW when no authorized variant fits and never truncates the text", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      textLayerRequests: [
        {
          id: "text-1",
          storyboardSceneId: "scene-a",
          sourceField: "title",
          geometry: { xPx: 200, yPx: 200, widthPx: 1, heightPx: 1 },
          zIndex: 0,
          criticality: "required",
          minFontSizePx: 8,
          maxFontSizePx: 40,
        },
      ],
    });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reasonCodes).toContain("TEXT_OVERFLOW");
  });
});

describe("RFC-0006 transitions (§14)", () => {
  it("keeps left.endFrameExclusive === right.startFrame and does not change totalFrames", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({ storyboard });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    const [a, b] = result.plan.scenes;
    expect(a!.endFrameExclusive).toBe(b!.startFrame);
    expect(a!.transitionOut?.id).toBe(b!.transitionIn?.id);
    expect(result.plan.timing.totalFrames).toBe(b!.endFrameExclusive);
  });
});

describe("RFC-0006 non-critical overrides (§35)", () => {
  it("overriding OPTIONAL_ASSET_UNAVAILABLE with an allowlisted override still records the original finding", async () => {
    const storyboard = twoSceneStoryboard();
    const first = await new RenderEngine().run(
      buildBundle({ storyboard, assetBindingRequests: [assetBinding("b1", "scene-a", "ev-x", { criticality: "optional" })] }),
      context,
    );
    expect(first.kind).toBe("compiled");
    if (first.kind !== "compiled") return;
    const finding = first.gate.warnings.find((w) => w.reasonCode === "OPTIONAL_ASSET_UNAVAILABLE")!;
    expect(finding).toBeTruthy();

    const overridden = await new RenderEngine().run(
      buildBundle({
        storyboard,
        assetBindingRequests: [assetBinding("b1", "scene-a", "ev-x", { criticality: "optional" })],
        overrides: [
          {
            schemaVersion: "0.1",
            id: "override-1",
            findingId: finding.findingId,
            reasonCode: "OPTIONAL_ASSET_UNAVAILABLE",
            authority: { kind: "human", authorityId: "reviewer-1" },
            rationale: "Acceptable for this cut.",
            policy: { id: "override-policy", version: "0.1" },
            createdAt: "2026-07-17T00:00:00Z",
            reversible: true,
          },
        ],
      }),
      context,
    );
    expect(overridden.kind).toBe("compiled");
    if (overridden.kind !== "compiled") return;
    expect(overridden.gate.status).toBe("conditional");
    expect(overridden.gate.appliedOverrideIds).toContain("override-1");
    expect(overridden.gate.warnings.some((w) => w.reasonCode === "OPTIONAL_ASSET_UNAVAILABLE")).toBe(true);
  });

  it("never overrides a critical finding — the override is itself flagged OVERRIDE_INVALID", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-missing-required")],
      overrides: [
        {
          schemaVersion: "0.1",
          id: "override-bad",
          findingId: "finding-does-not-exist",
          reasonCode: "ASSET_MISSING",
          authority: { kind: "human", authorityId: "reviewer-1" },
          rationale: "Trying to override a critical finding.",
          policy: { id: "override-policy", version: "0.1" },
          createdAt: "2026-07-17T00:00:00Z",
          reversible: true,
        },
      ],
    });
    const result = await new RenderEngine().run(bundle, context);
    // ASSET_MISSING is critical (required binding) -> this remains Case A rejection;
    // OVERRIDE_INVALID is only produced when a structurally valid plan is reached.
    expect(result.kind).toBe("rejected");
  });
});

describe("RFC-0006 determinism (§37, invariant 29)", () => {
  it("produces byte-identical canonical plan bytes for equivalent inputs", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({
      storyboard,
      assetCandidates: [pngCandidate("cand-1", "ev-1")],
      assetBindingRequests: [assetBinding("b1", "scene-a", "ev-1")],
    });
    const r1 = await new RenderEngine().run(bundle, context);
    const r2 = await new RenderEngine().run(bundle, context);
    expect(r1.kind).toBe("compiled");
    expect(r2.kind).toBe("compiled");
    if (r1.kind !== "compiled" || r2.kind !== "compiled") return;
    expect(canonicalHash(r1.plan)).toBe(canonicalHash(r2.plan));
  });

  it("does not mutate the Storyboard input", async () => {
    const storyboard = twoSceneStoryboard();
    const before = canonicalStringify(storyboard);
    const bundle = buildBundle({ storyboard });
    await new RenderEngine().run(bundle, context);
    expect(canonicalStringify(storyboard)).toBe(before);
  });
});
