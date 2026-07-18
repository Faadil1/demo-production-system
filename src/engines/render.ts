import { createHash } from "node:crypto";
import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import { canonicalHash, codePointCompare, deterministicId, layerSortKey, sortedByCodePoint } from "../core/render-canonical.js";
import { resolveOutputProfile } from "../core/render-profile.js";
import { detectMediaType } from "../core/render-media.js";
import { quantizeScenes } from "../core/frame-quantization.js";
import { frameRateToExact, compare as compareRational } from "../core/rational.js";
import type { RenderAssetCandidateRecord, RenderBindingRequest, RenderCompilerBundle, RenderTextLayerRequest } from "../core/render-input.js";
import {
  LAYER_KIND_RANK,
  OVERRIDE_ALLOWLISTED_REASON_CODES,
  PIPELINE_STAGE_RANK,
  type AssetPreparationRequirement,
  type RenderAllowedNextAction,
  type RenderAssetBinding,
  type RenderConstraint,
  type RenderFinding,
  type RenderFindingEvidence,
  type RenderFindingSource,
  type RenderGateReasonCode,
  type RenderGateResult,
  type RenderGateStatus,
  type RenderLayer,
  type RenderPipelineStage,
  type RenderPlan,
  type RenderProvenance,
  type RenderRejection,
  type RenderRequirement,
  type RenderScene,
  type RenderTransition,
  type RenderTransitionKind,
  type RenderWarning,
  type ResolvedRenderAsset,
} from "../core/render.js";
import type { StoryScene, StoryTransitionIntent } from "../core/story.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type RenderCompilationResult =
  | { readonly kind: "rejected"; readonly rejection: RenderRejection }
  | {
      readonly kind: "compiled";
      readonly plan: RenderPlan;
      readonly resolvedAssets: readonly ResolvedRenderAsset[];
      readonly preparationRequirements: readonly AssetPreparationRequirement[];
      readonly gate: RenderGateResult;
    };

// ---------------------------------------------------------------------------
// §8 closed entry-requirement classification policy v0.1
// ---------------------------------------------------------------------------

const RENDERER_BOUND_REQUIREMENT_PATTERNS: readonly RegExp[] = [
  /recapture/i,
  /output profile/i,
  /prepare asset/i,
  /layout requirement/i,
  /capability requirement/i,
];

function classifyEntryRequirement(text: string): "renderer-bound" | "narrative" {
  return RENDERER_BOUND_REQUIREMENT_PATTERNS.some((p) => p.test(text)) ? "renderer-bound" : "narrative";
}

// ---------------------------------------------------------------------------
// §25 transition realization policy v0.1 (Appendix E minimal transition policy)
// ---------------------------------------------------------------------------

const TRANSITION_INTENT_MAP: Readonly<Record<StoryTransitionIntent, RenderTransitionKind>> = {
  cut: "cut",
  hold: "hold",
  reveal: "cross-reveal",
  replace: "replace",
  compare: "before-after",
  focus: "focus",
  "zoom-intent": "focus",
  continuity: "continuity",
  "cause-to-effect": "before-after",
  "before-to-after": "before-after",
  "proof-to-result": "proof-result",
  conclusion: "conclusion",
};

/**
 * §33 aggregateGate distinguishes "a valid override exists" from "the reason registry
 * effect is conditional [by default]" — two independent routes to a non-blocking warning.
 * `OVERRIDE_ALLOWLISTED_REASON_CODES` (core/render.ts) governs the first (an explicit,
 * human-authored `RenderOverrideRecord` is required). This set governs the second: for a
 * finding that is already non-critical (§34 — every affected item is explicitly optional
 * and the plan remains executable without it), these reason codes have a registry-default
 * conditional effect with no override required, because the underlying defect only ever
 * touches an optional element.
 */
const DEFAULT_CONDITIONAL_REASON_CODES: ReadonlySet<RenderGateReasonCode> = new Set([
  "OPTIONAL_ASSET_UNAVAILABLE",
  "OPTIONAL_ASSET_RECAPTURE_RECOMMENDED",
  "NON_CRITICAL_LAYOUT_DEGRADATION",
  "ASSET_FORMAT_UNSUPPORTED",
  "ASSET_CORRUPT",
  "ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS",
  "ASSET_STALE",
]);

const TRANSITION_POLICY = { id: "minimal-transition-policy", version: "0.1" } as const;
const LAYOUT_POLICY_ID = { id: "minimal-layout-policy", version: "0.1" } as const;

// ---------------------------------------------------------------------------
// Deterministic text measurement reference model (§26-27)
// ---------------------------------------------------------------------------

const DEFAULT_CHAR_WIDTH_FACTOR = 0.58;
const LINE_HEIGHT_FACTOR = 1.2;

function measure(text: string, fontSizePx: number, charWidthFactor: number): { readonly widthPx: number; readonly heightPx: number } {
  return { widthPx: text.length * fontSizePx * charWidthFactor, heightPx: fontSizePx * LINE_HEIGHT_FACTOR };
}

function fits(text: string, fontSizePx: number, charWidthFactor: number, boxWidthPx: number, boxHeightPx: number): boolean {
  const m = measure(text, fontSizePx, charWidthFactor);
  return m.widthPx <= boxWidthPx && m.heightPx <= boxHeightPx;
}

function greatestFittingFontSize(
  text: string,
  minSizePx: number,
  maxSizePx: number,
  charWidthFactor: number,
  boxWidthPx: number,
  boxHeightPx: number,
): number | null {
  for (let size = Math.floor(maxSizePx); size >= Math.ceil(minSizePx); size--) {
    if (fits(text, size, charWidthFactor, boxWidthPx, boxHeightPx)) return size;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Finding construction helpers
// ---------------------------------------------------------------------------

function mkFinding(args: {
  readonly stage: RenderPipelineStage;
  readonly reasonCode: RenderGateReasonCode;
  readonly outcome: "satisfied" | "unsatisfied";
  readonly criticality: "critical" | "non-critical";
  readonly affectedIds: readonly string[];
  readonly evidence: readonly RenderFindingEvidence[];
  readonly source: RenderFindingSource;
}): RenderFinding {
  const id = deterministicId("finding", args.stage, args.reasonCode, args.affectedIds.join(","), args.source.kind);
  return { id, ...args };
}

const NEXT_ACTION_FOR_REASON: Partial<Record<RenderGateReasonCode, RenderAllowedNextAction>> = {
  RENDER_COMPILER_INPUT_INVALID: "correct-render-input",
  STORY_GATE_INELIGIBLE: "resolve-upstream-story-requirement",
  STORY_GATE_REQUIREMENT_NOT_RENDERER_BOUND: "resolve-upstream-story-requirement",
  STORYBOARD_NOT_FOUND: "restore-artifact",
  STORYBOARD_HASH_MISMATCH: "restore-artifact",
  STORYBOARD_REFERENCE_INVALID: "correct-render-input",
  DEPENDENCY_ARTIFACT_NOT_FOUND: "restore-artifact",
  OUTPUT_PROFILE_NOT_FOUND: "select-output-profile",
  OUTPUT_PROFILE_HASH_MISMATCH: "select-output-profile",
  OUTPUT_PROFILE_INVALID: "select-output-profile",
  OUTPUT_PROFILE_CONTRADICTORY: "select-output-profile",
  OUTPUT_PROFILE_UNSUPPORTED: "select-output-profile",
  REQUIRED_AUXILIARY_TRACK_MISSING: "compile-required-auxiliary-track",
  REQUIRED_AUXILIARY_TRACK_INVALID: "compile-required-auxiliary-track",
  RENDER_PLAN_STRUCTURALLY_INVALID: "retry-render-planning",
  REQUIRED_LAYER_UNREALIZABLE: "retry-render-planning",
  TIMING_ALLOCATION_IMPOSSIBLE: "revise-versioned-policy",
  FRAME_ROUNDING_INVARIANT_FAILED: "retry-render-planning",
  TRANSITION_POLICY_UNRESOLVED: "revise-versioned-policy",
  TRANSITION_OVERLAP_INVALID: "retry-render-planning",
  ASSET_BINDING_UNRESOLVED: "select-authoritative-asset",
  ASSET_MISSING: "recapture-authorized-evidence",
  ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS: "select-authoritative-asset",
  ASSET_HASH_MISMATCH: "restore-artifact",
  ASSET_CORRUPT: "restore-artifact",
  ASSET_FORMAT_UNSUPPORTED: "select-authoritative-asset",
  ASSET_STALE: "recapture-authorized-evidence",
  ASSET_PREPARATION_FAILED: "prepare-asset",
  CONTENT_OUT_OF_FRAME: "revise-versioned-policy",
  SAFE_AREA_VIOLATION: "revise-versioned-policy",
  MINIMUM_SIZE_VIOLATION: "revise-versioned-policy",
  REQUIRED_ELEMENTS_OVERLAP: "revise-versioned-policy",
  RESERVED_REGION_MISSING: "revise-versioned-policy",
  TEXT_OVERFLOW: "provide-approved-text-variant",
  ADAPTER_CAPABILITIES_NOT_FOUND: "select-compatible-adapter",
  ADAPTER_CAPABILITIES_HASH_MISMATCH: "select-compatible-adapter",
  ADAPTER_CAPABILITIES_INVALID: "select-compatible-adapter",
  ADAPTER_LAYER_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_SCENE_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_TRANSITION_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_TYPOGRAPHY_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_MEDIA_TYPE_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_DIMENSIONS_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_TIMEBASE_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_COLOR_SPACE_UNSUPPORTED: "select-compatible-adapter",
  ADAPTER_AUDIO_MODE_UNSUPPORTED: "select-compatible-adapter",
  OPTIONAL_ASSET_UNAVAILABLE: "recapture-authorized-evidence",
  OPTIONAL_ASSET_RECAPTURE_RECOMMENDED: "recapture-authorized-evidence",
  NON_CRITICAL_LAYOUT_DEGRADATION: "revise-versioned-policy",
  OVERRIDE_INVALID: "remove-invalid-override",
  OVERRIDE_NOT_ALLOWLISTED: "remove-invalid-override",
};

function requirementFor(finding: RenderFinding): RenderRequirement {
  return {
    id: deterministicId("requirement", finding.id),
    reasonCode: finding.reasonCode,
    allowedNextAction: NEXT_ACTION_FOR_REASON[finding.reasonCode] ?? "retry-render-planning",
    affectedIds: finding.affectedIds,
  };
}

function canonicalFindingOrder(findings: readonly RenderFinding[]): readonly RenderFinding[] {
  return [...findings].sort((a, b) => {
    const stageDiff = PIPELINE_STAGE_RANK[a.stage] - PIPELINE_STAGE_RANK[b.stage];
    if (stageDiff !== 0) return stageDiff;
    const reasonDiff = codePointCompare(a.reasonCode, b.reasonCode);
    if (reasonDiff !== 0) return reasonDiff;
    const critA = a.criticality === "critical" ? 0 : 1;
    const critB = b.criticality === "critical" ? 0 : 1;
    if (critA !== critB) return critA - critB;
    const affectedA = [...a.affectedIds].sort(codePointCompare).join(",");
    const affectedB = [...b.affectedIds].sort(codePointCompare).join(",");
    const affectedDiff = codePointCompare(affectedA, affectedB);
    if (affectedDiff !== 0) return affectedDiff;
    const sourceDiff = codePointCompare(a.source.kind, b.source.kind);
    if (sourceDiff !== 0) return sourceDiff;
    return codePointCompare(a.id, b.id);
  });
}

// ---------------------------------------------------------------------------
// RenderEngine
// ---------------------------------------------------------------------------

export class RenderEngine implements Engine<RenderCompilerBundle, RenderCompilationResult> {
  readonly name = "reference-render-engine";
  readonly version = "0.1.0";

  private lastMetrics: EngineMetrics = { inputArtifacts: 0, outputArtifacts: 0, warnings: 0 };

  validate(bundle: RenderCompilerBundle): ValidationResult {
    const issues: { path: string; code: string; message: string }[] = [];
    const input = bundle.input;
    const scalarFields: [string, string][] = [
      ["storyboardArtifactId", input.storyboardArtifactId],
      ["expectedStoryboardContentHash", input.expectedStoryboardContentHash],
      ["assetResolutionPolicy.id", input.assetResolutionPolicy.id],
      ["assetResolutionPolicy.version", input.assetResolutionPolicy.version],
      ["transitionPolicy.id", input.transitionPolicy.id],
      ["transitionPolicy.version", input.transitionPolicy.version],
      ["layoutPolicy.id", input.layoutPolicy.id],
      ["layoutPolicy.version", input.layoutPolicy.version],
      ["adapterCapabilitiesArtifactId", input.adapterCapabilitiesArtifactId],
    ];
    for (const [path, value] of scalarFields) {
      if (!value || value.trim().length === 0) {
        issues.push({ path, code: "empty-scalar", message: `${path} MUST be non-empty after trimming.` });
      }
    }
    if (input.schemaVersion !== "0.1") {
      issues.push({ path: "schemaVersion", code: "schema-mismatch", message: 'schemaVersion must be "0.1".' });
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  async run(bundle: RenderCompilerBundle, _context: EngineContext): Promise<RenderCompilationResult> {
    const findings: RenderFinding[] = [];
    const { input, storyboard } = bundle;

    const provenanceBase = () => {
      const policies = [input.assetResolutionPolicy, input.transitionPolicy, input.layoutPolicy];
      const dependencyArtifactIds = sortedByCodePoint(
        [input.storyboardArtifactId, input.adapterCapabilitiesArtifactId, ...input.auxiliaryTrackArtifactIds, ...input.overrideArtifactIds],
        (x) => x,
      );
      const provenance: RenderProvenance = {
        schemaVersion: "0.1",
        compiler: { name: this.name, version: this.version },
        storyboardArtifactId: input.storyboardArtifactId,
        storyboardSchemaVersion: storyboard.schemaVersion,
        storyboardContentHash: bundle.storyboardContentHash,
        outputProfileSource: input.outputProfile,
        resolvedOutputProfileId: resolvedProfileId,
        resolvedOutputProfileVersion: resolvedProfileVersion,
        resolvedOutputProfileHash: resolvedProfileHash,
        adapterCapabilitiesArtifactId: input.adapterCapabilitiesArtifactId,
        adapterVersion: bundle.adapterCapabilities.adapter.version,
        adapterCapabilitiesHash: bundle.adapterCapabilitiesHash,
        policies,
        dependencyArtifactIds,
        appliedOverrideIds,
      };
      return provenance;
    };

    let resolvedProfileId = "";
    let resolvedProfileVersion = "";
    let resolvedProfileHash = "";
    let appliedOverrideIds: string[] = [];

    const reject = (stage: RenderPipelineStage): RenderCompilationResult => {
      const blocking = findings.filter((f) => f.outcome === "unsatisfied" && f.criticality === "critical");
      const ordered = canonicalFindingOrder(blocking.length > 0 ? blocking : findings.filter((f) => f.outcome === "unsatisfied"));
      const rejection: RenderRejection = {
        schemaVersion: "0.1",
        status: "rejected",
        stage,
        reasonCodes: sortedByCodePoint([...new Set(ordered.map((f) => f.reasonCode))], (x) => x),
        findings: ordered,
        requirements: ordered.map(requirementFor),
        inputArtifactIds: sortedByCodePoint([input.storyboardArtifactId, input.adapterCapabilitiesArtifactId], (x) => x),
        provenance: provenanceBase(),
      };
      return { kind: "rejected", rejection };
    };

    // -----------------------------------------------------------------------
    // §8 Entry eligibility
    // -----------------------------------------------------------------------
    const computedStoryboardHash = canonicalHash(storyboard);
    if (computedStoryboardHash !== bundle.storyboardContentHash || bundle.storyboardContentHash !== input.expectedStoryboardContentHash) {
      findings.push(
        mkFinding({
          stage: "entry",
          reasonCode: "STORYBOARD_HASH_MISMATCH",
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [input.storyboardArtifactId],
          evidence: [{ kind: "hash", detail: `computed=${computedStoryboardHash} expected=${input.expectedStoryboardContentHash}` }],
          source: { kind: "entry" },
        }),
      );
      return reject("entry");
    }

    if (storyboard.gate.status === "fail") {
      findings.push(
        mkFinding({
          stage: "entry",
          reasonCode: "STORY_GATE_INELIGIBLE",
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [input.storyboardArtifactId],
          evidence: storyboard.gate.blockingReasons.map((r) => ({ kind: "story-gate-blocking-reason", detail: r })),
          source: { kind: "entry" },
        }),
      );
      return reject("entry");
    }

    if (storyboard.gate.status === "conditional") {
      for (const requirement of storyboard.gate.requirementsBeforeRender) {
        if (classifyEntryRequirement(requirement) !== "renderer-bound") {
          findings.push(
            mkFinding({
              stage: "entry",
              reasonCode: "STORY_GATE_REQUIREMENT_NOT_RENDERER_BOUND",
              outcome: "unsatisfied",
              criticality: "critical",
              affectedIds: [input.storyboardArtifactId],
              evidence: [{ kind: "requirement", detail: requirement }],
              source: { kind: "entry" },
            }),
          );
          return reject("entry");
        }
      }
    }

    // -----------------------------------------------------------------------
    // §11 Output profile resolution
    // -----------------------------------------------------------------------
    const profileResolution = resolveOutputProfile(input.outputProfile);
    if (!profileResolution.ok) {
      findings.push(
        mkFinding({
          stage: "profile-resolution",
          reasonCode: profileResolution.reasonCode,
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [input.outputProfile.kind === "registered" ? input.outputProfile.profileArtifactId : "inline-custom"],
          evidence: [{ kind: "detail", detail: profileResolution.detail }],
          source: { kind: "profile-resolution" },
        }),
      );
      return reject("profile-resolution");
    }
    const resolvedProfile = profileResolution.profile;
    resolvedProfileId = resolvedProfile.id;
    resolvedProfileVersion = resolvedProfile.version;
    resolvedProfileHash = profileResolution.hash;

    // -----------------------------------------------------------------------
    // §16-18 Asset binding, resolution, integrity
    // -----------------------------------------------------------------------
    const assetBindings: RenderAssetBinding[] = [];
    const resolvedAssets: ResolvedRenderAsset[] = [];
    const requiredBindingUnresolved = new Set<string>();

    for (const req of sortedByCodePoint(bundle.assetBindingRequests, (r) => r.id)) {
      const binding: RenderAssetBinding = {
        id: req.id,
        storyboardSceneId: req.storyboardSceneId,
        renderLayerId: req.renderLayerId,
        evidenceRefId: req.evidenceRefId,
        role: req.role,
        criticality: req.criticality,
        acceptableMediaTypes: req.acceptableMediaTypes,
        selectionPolicy: input.assetResolutionPolicy,
      };
      assetBindings.push(binding);

      const sceneExists = storyboard.scenes.some((s) => s.id === req.storyboardSceneId);
      if (!sceneExists) {
        findings.push(
          mkFinding({
            stage: "asset-binding",
            reasonCode: "STORYBOARD_REFERENCE_INVALID",
            outcome: "unsatisfied",
            criticality: "critical",
            affectedIds: [req.id],
            evidence: [{ kind: "storyboardSceneId", detail: req.storyboardSceneId }],
            source: { kind: "asset-binding", bindingId: req.id },
          }),
        );
        if (req.criticality === "required") requiredBindingUnresolved.add(req.id);
        continue;
      }

      const candidates = sortedByCodePoint(
        bundle.assetCandidates.filter((c) => c.evidenceRefId === req.evidenceRefId),
        (c) => c.id,
      );

      type NormalizedCandidate = RenderAssetCandidateRecord & { readonly bytes: Buffer; readonly hash: string; readonly detected: ReturnType<typeof detectMediaType> };
      const normalized: NormalizedCandidate[] = [];
      const seenKeys = new Set<string>();
      for (const c of candidates) {
        const bytes = Buffer.from(c.bytesBase64, "base64");
        const hash = createHash("sha256").update(bytes).digest("hex");
        const key = `${c.source.kind}:${c.source.sourceArtifactId}:${hash}`;
        if (seenKeys.has(key)) continue; // §16 dedup exact source identity + content hash
        seenKeys.add(key);
        const detected = detectMediaType(bytes);
        normalized.push({ ...c, bytes, hash, detected });
      }

      const eligible = normalized.filter((c) => req.acceptableMediaTypes.includes(c.declaredMediaType) && c.detected === c.declaredMediaType);

      for (const c of normalized) {
        if (c.detected === null) {
          findings.push(
            mkFinding({
              stage: "asset-integrity",
              reasonCode: "ASSET_FORMAT_UNSUPPORTED",
              outcome: "unsatisfied",
              criticality: req.criticality === "required" ? "critical" : "non-critical",
              affectedIds: [c.id],
              evidence: [{ kind: "declaredMediaType", detail: c.declaredMediaType }],
              source: { kind: "asset-integrity", candidateId: c.id },
            }),
          );
        } else if (c.detected !== c.declaredMediaType) {
          findings.push(
            mkFinding({
              stage: "asset-integrity",
              reasonCode: "ASSET_CORRUPT",
              outcome: "unsatisfied",
              criticality: req.criticality === "required" ? "critical" : "non-critical",
              affectedIds: [c.id],
              evidence: [{ kind: "mediaTypeMismatch", detail: `declared=${c.declaredMediaType} detected=${c.detected}` }],
              source: { kind: "asset-integrity", candidateId: c.id },
            }),
          );
        } else if (c.declaredByteLength !== undefined && c.declaredByteLength !== c.bytes.length) {
          findings.push(
            mkFinding({
              stage: "asset-integrity",
              reasonCode: "ASSET_CORRUPT",
              outcome: "unsatisfied",
              criticality: req.criticality === "required" ? "critical" : "non-critical",
              affectedIds: [c.id],
              evidence: [{ kind: "byteLengthMismatch", detail: `declared=${c.declaredByteLength} actual=${c.bytes.length}` }],
              source: { kind: "asset-integrity", candidateId: c.id },
            }),
          );
        }
      }

      if (eligible.length === 0) {
        if (req.criticality === "required") {
          findings.push(
            mkFinding({
              stage: "asset-resolution",
              reasonCode: candidates.length === 0 ? "ASSET_MISSING" : "ASSET_BINDING_UNRESOLVED",
              outcome: "unsatisfied",
              criticality: "critical",
              affectedIds: [req.id],
              evidence: [{ kind: "candidateCount", detail: String(candidates.length) }],
              source: { kind: "asset-resolution", bindingId: req.id },
            }),
          );
          requiredBindingUnresolved.add(req.id);
        } else {
          // §18: an optional unavailable asset MUST be omitted, not represented as an
          // invalid resolved asset — reported only via the dedicated non-critical code.
          findings.push(
            mkFinding({
              stage: "asset-resolution",
              reasonCode: "OPTIONAL_ASSET_UNAVAILABLE",
              outcome: "unsatisfied",
              criticality: "non-critical",
              affectedIds: [req.id],
              evidence: [{ kind: "candidateCount", detail: String(candidates.length) }],
              source: { kind: "asset-resolution", bindingId: req.id },
            }),
          );
        }
        continue;
      }

      // §16 selection: rank by policyPreferenceRank (lower=better), tie-break by content
      // hash then artifact id then source item id (dimensions 6-9).
      const ranked = [...eligible].sort((a, b) => {
        const rankA = a.policyPreferenceRank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.policyPreferenceRank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        const hashDiff = codePointCompare(a.hash, b.hash);
        if (hashDiff !== 0) return hashDiff;
        return codePointCompare(a.id, b.id);
      });
      const bestRank = ranked[0]!.policyPreferenceRank ?? Number.MAX_SAFE_INTEGER;
      const bestGroup = ranked.filter((c) => (c.policyPreferenceRank ?? Number.MAX_SAFE_INTEGER) === bestRank);
      const distinctSources = new Set(bestGroup.map((c) => `${c.source.kind}:${c.source.sourceArtifactId}:${"sourceItemId" in c.source ? c.source.sourceItemId : ""}`));

      if (distinctSources.size > 1) {
        findings.push(
          mkFinding({
            stage: "asset-resolution",
            reasonCode: "ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS",
            outcome: "unsatisfied",
            criticality: req.criticality === "required" ? "critical" : "non-critical",
            affectedIds: [req.id, ...bestGroup.map((c) => c.id)],
            evidence: bestGroup.map((c) => ({ kind: "candidateId", detail: c.id })),
            source: { kind: "asset-resolution", bindingId: req.id },
          }),
        );
        if (req.criticality === "required") requiredBindingUnresolved.add(req.id);
        continue;
      }

      const winner = bestGroup[0]!;
      resolvedAssets.push({
        schemaVersion: "0.1",
        id: deterministicId("resolved-asset", req.id, winner.id),
        bindingId: req.id,
        evidenceRefId: req.evidenceRefId,
        source: winner.source,
        sourceContentHash: winner.hash,
        mediaType: winner.declaredMediaType,
        byteLength: winner.bytes.length,
        ...(winner.declaredWidthPx !== undefined ? { intrinsicWidthPx: winner.declaredWidthPx } : {}),
        ...(winner.declaredHeightPx !== undefined ? { intrinsicHeightPx: winner.declaredHeightPx } : {}),
        ...(winner.declaredDurationMs !== undefined ? { intrinsicDurationMs: winner.declaredDurationMs } : {}),
        preparationRequirementIds: [],
      });
    }

    // -----------------------------------------------------------------------
    // §19 Mechanical preparation (deterministic mock — see implementation doc)
    // -----------------------------------------------------------------------
    const preparationRequirements: AssetPreparationRequirement[] = [];
    const resolvedAssetsById = new Map(resolvedAssets.map((a) => [a.bindingId, a]));
    for (const req of bundle.assetBindingRequests) {
      const asset = resolvedAssetsById.get(req.id);
      if (!asset) continue;
      const needsResize = asset.intrinsicWidthPx !== undefined && asset.intrinsicHeightPx !== undefined && (asset.intrinsicWidthPx !== req.geometry.widthPx || asset.intrinsicHeightPx !== req.geometry.heightPx);
      if (!needsResize) continue;
      const prepId = deterministicId("prep", req.id, "resize-contain");
      preparationRequirements.push({
        id: prepId,
        bindingId: req.id,
        operation: "resize-contain",
        parameters: { targetWidthPx: req.geometry.widthPx, targetHeightPx: req.geometry.heightPx },
        required: req.criticality === "required",
        policy: input.assetResolutionPolicy,
      });
      const idx = resolvedAssets.findIndex((a) => a.bindingId === req.id);
      if (idx >= 0) {
        // Reference/mock preparation adapter: deterministic pass-through. No real pixel
        // transform occurs; see Known Limitations in the implementation doc.
        resolvedAssets[idx] = {
          ...resolvedAssets[idx]!,
          preparedArtifactId: deterministicId("prepared-artifact", req.id),
          preparedContentHash: resolvedAssets[idx]!.sourceContentHash,
          preparationRequirementIds: [prepId],
        };
      }
    }

    if (requiredBindingUnresolved.size > 0) {
      return reject("asset-resolution");
    }

    // -----------------------------------------------------------------------
    // §13-14 Timing quantization
    // -----------------------------------------------------------------------
    const orderedStoryScenes: readonly StoryScene[] = sortedByCodePoint(storyboard.scenes, (s) => s.id).sort((a, b) => a.order - b.order);
    const quantization = quantizeScenes(
      orderedStoryScenes.map((s) => ({ id: s.id, durationTargetMs: s.durationTargetMs })),
      resolvedProfile.frameRate,
    );
    if (!quantization.ok) {
      findings.push(
        mkFinding({
          stage: "timing",
          reasonCode: "TIMING_ALLOCATION_IMPOSSIBLE",
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [orderedStoryScenes[quantization.zeroFrameSceneIndex]?.id ?? "unknown"],
          evidence: [{ kind: "sceneIndex", detail: String(quantization.zeroFrameSceneIndex) }],
          source: { kind: "timing", ...(orderedStoryScenes[quantization.zeroFrameSceneIndex]?.id ? { sceneId: orderedStoryScenes[quantization.zeroFrameSceneIndex]!.id } : {}) },
        }),
      );
      return reject("timing");
    }

    // -----------------------------------------------------------------------
    // §25 Transition mapping
    // -----------------------------------------------------------------------
    const renderScenes: RenderScene[] = [];
    for (let i = 0; i < orderedStoryScenes.length; i++) {
      const storyScene = orderedStoryScenes[i]!;
      const frame = quantization.frames[i]!;

      const bindingsForScene = assetBindings.filter((b) => b.storyboardSceneId === storyScene.id);
      const textRequestsForScene = bundle.textLayerRequests.filter((t) => t.storyboardSceneId === storyScene.id);

      const layers: RenderLayer[] = [];
      for (const req of bundle.assetBindingRequests.filter((r) => r.storyboardSceneId === storyScene.id)) {
        const asset = resolvedAssetsById.get(req.id);
        if (!asset) continue; // optional, unavailable — correctly omitted (§18)
        layers.push({
          id: req.renderLayerId,
          kind: "asset",
          zIndex: req.zIndex,
          geometry: req.geometry,
          activeFrameRange: { startFrame: frame.startFrame, endFrameExclusive: frame.endFrameExclusive },
          criticality: req.criticality,
          styleTokenIds: [],
          constraintIds: [],
          resolvedAssetId: asset.id,
          bindingId: req.id,
        });
      }

      for (const treq of textRequestsForScene) {
        const originalText = storyScene[treq.sourceField];
        const charWidthFactor = treq.approxCharWidthFactor ?? DEFAULT_CHAR_WIDTH_FACTOR;
        let fittingSize = greatestFittingFontSize(originalText, treq.minFontSizePx, treq.maxFontSizePx, charWidthFactor, treq.geometry.widthPx, treq.geometry.heightPx);
        let resolvedText = originalText;
        let usedVariantId: string | undefined;

        if (fittingSize === null && treq.approvedVariants && treq.approvedVariants.length > 0) {
          const orderedVariants = [...treq.approvedVariants].sort((a, b) => {
            if (a.authoritativePriority !== b.authoritativePriority) return a.authoritativePriority - b.authoritativePriority;
            return codePointCompare(a.id, b.id);
          });
          for (const variant of orderedVariants) {
            const size = greatestFittingFontSize(variant.text, treq.minFontSizePx, treq.maxFontSizePx, charWidthFactor, treq.geometry.widthPx, treq.geometry.heightPx);
            if (size !== null) {
              fittingSize = size;
              resolvedText = variant.text;
              usedVariantId = variant.id;
              break;
            }
          }
        }

        if (fittingSize === null) {
          findings.push(
            mkFinding({
              stage: "layout",
              reasonCode: "TEXT_OVERFLOW",
              outcome: "unsatisfied",
              criticality: treq.criticality === "required" ? "critical" : "non-critical",
              affectedIds: [treq.id],
              evidence: [{ kind: "text", detail: originalText }],
              source: { kind: "constraint", constraintId: deterministicId("constraint", treq.id, "text-fit") },
            }),
          );
          fittingSize = treq.minFontSizePx;
        }

        layers.push({
          id: treq.id,
          kind: "text",
          zIndex: treq.zIndex,
          geometry: treq.geometry,
          activeFrameRange: { startFrame: frame.startFrame, endFrameExclusive: frame.endFrameExclusive },
          criticality: treq.criticality,
          styleTokenIds: [],
          constraintIds: [],
          source: { kind: "storyboard-authorized", storyboardSceneId: storyScene.id, sourceField: treq.sourceField },
          resolvedText,
          resolvedFontSizePx: fittingSize,
          ...(usedVariantId ? { usedVariantId } : {}),
        });
      }

      layers.sort((a, b) => codePointCompare(layerSortKey(a.zIndex, LAYER_KIND_RANK[a.kind], a.id), layerSortKey(b.zIndex, LAYER_KIND_RANK[b.kind], b.id)));

      // §14/§25 transitions: map from Storyboard transitionOut of the left scene / transitionIn
      // of the right scene at each boundary (Appendix E minimal transition policy).
      const previousStoryScene = i > 0 ? orderedStoryScenes[i - 1] : undefined;
      const previousFrame = i > 0 ? quantization.frames[i - 1] : undefined;
      let transitionIn: RenderTransition | null = null;
      if (previousStoryScene && previousFrame) {
        const kind = TRANSITION_INTENT_MAP[storyScene.transitionIn] ?? TRANSITION_INTENT_MAP[previousStoryScene.transitionOut];
        const windowFrames = Math.min(10, Math.floor(Math.min(previousFrame.durationFrames, frame.durationFrames) / 4));
        transitionIn = {
          id: deterministicId("transition", previousStoryScene.id, storyScene.id),
          policy: TRANSITION_POLICY,
          kind,
          sourceStoryIntent: storyScene.transitionIn,
          leftSceneId: previousStoryScene.id,
          rightSceneId: storyScene.id,
          transitionWindowFrames: windowFrames,
          requiredCapabilityId: `transition-${kind}`,
        };
        if (windowFrames > previousFrame.durationFrames || windowFrames > frame.durationFrames || previousFrame.endFrameExclusive !== frame.startFrame) {
          findings.push(
            mkFinding({
              stage: "transition",
              reasonCode: "TRANSITION_OVERLAP_INVALID",
              outcome: "unsatisfied",
              criticality: "critical",
              affectedIds: [transitionIn.id],
              evidence: [],
              source: { kind: "transition", transitionId: transitionIn.id },
            }),
          );
        }
      }

      renderScenes.push({
        id: deterministicId("scene", storyScene.id),
        storyboardSceneId: storyScene.id,
        storyboardSequenceId: storyScene.sequenceId,
        order: storyScene.order,
        startFrame: frame.startFrame,
        endFrameExclusive: frame.endFrameExclusive,
        durationFrames: frame.durationFrames,
        narrativeDurationMs: storyScene.durationTargetMs,
        transitionIn,
        transitionOut: null, // populated on the next iteration's transitionIn from this scene's perspective is redundant; left transitionOut intentionally mirrors transitionIn of the next scene and is wired below.
        layers,
        constraintIds: [],
        requiredCapabilityIds: [],
      });

      void bindingsForScene;
    }
    // wire transitionOut = next scene's transitionIn (single transition object shared at each boundary)
    for (let i = 0; i < renderScenes.length - 1; i++) {
      const next = renderScenes[i + 1]!;
      renderScenes[i] = { ...renderScenes[i]!, transitionOut: next.transitionIn };
    }

    if (findings.some((f) => f.reasonCode === "TRANSITION_OVERLAP_INVALID" && f.criticality === "critical")) {
      return reject("transition");
    }

    // -----------------------------------------------------------------------
    // §31 Objective layout constraints
    // -----------------------------------------------------------------------
    const constraints: RenderConstraint[] = [];
    const MIN_DIMENSION_PX = 8;
    for (const scene of renderScenes) {
      for (const layer of scene.layers) {
        const boundsId = deterministicId("constraint", scene.id, layer.id, "bounds");
        const withinFrame =
          layer.geometry.xPx >= 0 &&
          layer.geometry.yPx >= 0 &&
          layer.geometry.xPx + layer.geometry.widthPx <= resolvedProfile.widthPx &&
          layer.geometry.yPx + layer.geometry.heightPx <= resolvedProfile.heightPx;
        constraints.push({ id: boundsId, kind: "bounds", targetIds: [layer.id], criticality: layer.criticality === "required" ? "critical" : "non-critical", policy: LAYOUT_POLICY_ID, failureCode: "CONTENT_OUT_OF_FRAME" });
        if (!withinFrame) {
          findings.push(
            mkFinding({
              stage: "layout",
              reasonCode: "CONTENT_OUT_OF_FRAME",
              outcome: "unsatisfied",
              criticality: layer.criticality === "required" ? "critical" : "non-critical",
              affectedIds: [layer.id],
              evidence: [{ kind: "geometry", detail: JSON.stringify(layer.geometry) }],
              source: { kind: "constraint", constraintId: boundsId },
            }),
          );
        }

        if (layer.criticality === "required") {
          const safeId = deterministicId("constraint", scene.id, layer.id, "safe-area");
          const insets = resolvedProfile.safeAreaInsetsPx;
          const withinSafeArea =
            layer.geometry.xPx >= insets.left &&
            layer.geometry.yPx >= insets.top &&
            layer.geometry.xPx + layer.geometry.widthPx <= resolvedProfile.widthPx - insets.right &&
            layer.geometry.yPx + layer.geometry.heightPx <= resolvedProfile.heightPx - insets.bottom;
          constraints.push({ id: safeId, kind: "safe-area", targetIds: [layer.id], criticality: "critical", policy: LAYOUT_POLICY_ID, failureCode: "SAFE_AREA_VIOLATION" });
          if (!withinSafeArea) {
            findings.push(
              mkFinding({
                stage: "layout",
                reasonCode: "SAFE_AREA_VIOLATION",
                outcome: "unsatisfied",
                criticality: "critical",
                affectedIds: [layer.id],
                evidence: [{ kind: "geometry", detail: JSON.stringify(layer.geometry) }],
                source: { kind: "constraint", constraintId: safeId },
              }),
            );
          }
        }

        const minSizeId = deterministicId("constraint", scene.id, layer.id, "minimum-size");
        constraints.push({
          id: minSizeId,
          kind: "minimum-size",
          targetIds: [layer.id],
          criticality: layer.criticality === "required" ? "critical" : "non-critical",
          policy: LAYOUT_POLICY_ID,
          failureCode: "MINIMUM_SIZE_VIOLATION",
          minimumWidthPx: MIN_DIMENSION_PX,
          minimumHeightPx: MIN_DIMENSION_PX,
        });
        if (layer.geometry.widthPx < MIN_DIMENSION_PX || layer.geometry.heightPx < MIN_DIMENSION_PX) {
          findings.push(
            mkFinding({
              stage: "layout",
              reasonCode: "MINIMUM_SIZE_VIOLATION",
              outcome: "unsatisfied",
              criticality: layer.criticality === "required" ? "critical" : "non-critical",
              affectedIds: [layer.id],
              evidence: [{ kind: "geometry", detail: JSON.stringify(layer.geometry) }],
              source: { kind: "constraint", constraintId: minSizeId },
            }),
          );
        }
      }

      // non-overlap among required layers active in overlapping frame ranges
      const requiredLayers = scene.layers.filter((l) => l.criticality === "required");
      for (let a = 0; a < requiredLayers.length; a++) {
        for (let b = a + 1; b < requiredLayers.length; b++) {
          const la = requiredLayers[a]!;
          const lb = requiredLayers[b]!;
          const overlapId = deterministicId("constraint", scene.id, la.id, lb.id, "non-overlap");
          const rectOverlap =
            la.geometry.xPx < lb.geometry.xPx + lb.geometry.widthPx &&
            lb.geometry.xPx < la.geometry.xPx + la.geometry.widthPx &&
            la.geometry.yPx < lb.geometry.yPx + lb.geometry.heightPx &&
            lb.geometry.yPx < la.geometry.yPx + la.geometry.heightPx;
          constraints.push({ id: overlapId, kind: "non-overlap", targetIds: [la.id, lb.id], criticality: "critical", policy: LAYOUT_POLICY_ID, failureCode: "REQUIRED_ELEMENTS_OVERLAP" });
          if (rectOverlap) {
            findings.push(
              mkFinding({
                stage: "layout",
                reasonCode: "REQUIRED_ELEMENTS_OVERLAP",
                outcome: "unsatisfied",
                criticality: "critical",
                affectedIds: [la.id, lb.id],
                evidence: [],
                source: { kind: "constraint", constraintId: overlapId },
              }),
            );
          }
        }
      }
    }

    if (findings.some((f) => f.criticality === "critical" && f.outcome === "unsatisfied" && ["CONTENT_OUT_OF_FRAME", "SAFE_AREA_VIOLATION", "MINIMUM_SIZE_VIOLATION", "REQUIRED_ELEMENTS_OVERLAP", "TEXT_OVERFLOW"].includes(f.reasonCode))) {
      // A structurally valid plan cannot be produced when required layout invariants fail
      // (§9 step 15 precedes capability negotiation and gate aggregation).
      return reject("layout");
    }

    // -----------------------------------------------------------------------
    // §29-30 Capability negotiation
    // -----------------------------------------------------------------------
    const caps = bundle.adapterCapabilities;
    const usedLayerKinds = new Set(renderScenes.flatMap((s) => s.layers.map((l) => l.kind)));
    for (const kind of usedLayerKinds) {
      if (!caps.supportedLayerKinds.includes(kind)) {
        findings.push(
          mkFinding({
            stage: "capability-negotiation",
            reasonCode: "ADAPTER_LAYER_UNSUPPORTED",
            outcome: "unsatisfied",
            criticality: "critical",
            affectedIds: [kind],
            evidence: [],
            source: { kind: "adapter-capability", capabilityId: `layer-kind-${kind}` },
          }),
        );
      }
    }
    const usedMediaTypes = new Set(resolvedAssets.map((a) => a.mediaType));
    for (const mt of usedMediaTypes) {
      if (!caps.supportedMediaTypes.includes(mt)) {
        findings.push(
          mkFinding({
            stage: "capability-negotiation",
            reasonCode: "ADAPTER_MEDIA_TYPE_UNSUPPORTED",
            outcome: "unsatisfied",
            criticality: "critical",
            affectedIds: [mt],
            evidence: [],
            source: { kind: "adapter-capability", capabilityId: `media-type-${mt}` },
          }),
        );
      }
    }
    const usedTransitions = new Set(renderScenes.flatMap((s) => [s.transitionIn?.kind, s.transitionOut?.kind]).filter((k): k is RenderTransitionKind => Boolean(k)));
    for (const tk of usedTransitions) {
      if (!caps.supportedTransitions.includes(tk)) {
        findings.push(
          mkFinding({
            stage: "capability-negotiation",
            reasonCode: "ADAPTER_TRANSITION_UNSUPPORTED",
            outcome: "unsatisfied",
            criticality: "critical",
            affectedIds: [tk],
            evidence: [],
            source: { kind: "adapter-capability", capabilityId: `transition-${tk}` },
          }),
        );
      }
    }
    if (resolvedProfile.widthPx < caps.widthRangePx.minimum || resolvedProfile.widthPx > caps.widthRangePx.maximum || resolvedProfile.heightPx < caps.heightRangePx.minimum || resolvedProfile.heightPx > caps.heightRangePx.maximum) {
      findings.push(
        mkFinding({
          stage: "capability-negotiation",
          reasonCode: "ADAPTER_DIMENSIONS_UNSUPPORTED",
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [resolvedProfile.id],
          evidence: [{ kind: "dimensions", detail: `${resolvedProfile.widthPx}x${resolvedProfile.heightPx}` }],
          source: { kind: "adapter-capability", capabilityId: "dimensions" },
        }),
      );
    }
    const exactProfileFps = frameRateToExact(resolvedProfile.frameRate);
    const timebaseSupported = caps.supportedFrameRates.some((r) => compareRational(frameRateToExact(r), exactProfileFps) === 0);
    if (!timebaseSupported) {
      findings.push(
        mkFinding({
          stage: "capability-negotiation",
          reasonCode: "ADAPTER_TIMEBASE_UNSUPPORTED",
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [resolvedProfile.id],
          evidence: [],
          source: { kind: "adapter-capability", capabilityId: "frame-rate" },
        }),
      );
    }
    if (!caps.supportedColorSpaces.includes(resolvedProfile.colorSpace)) {
      findings.push(
        mkFinding({
          stage: "capability-negotiation",
          reasonCode: "ADAPTER_COLOR_SPACE_UNSUPPORTED",
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [resolvedProfile.colorSpace],
          evidence: [],
          source: { kind: "adapter-capability", capabilityId: "color-space" },
        }),
      );
    }
    if (!caps.supportedAudioModes.includes(resolvedProfile.audioMode)) {
      findings.push(
        mkFinding({
          stage: "capability-negotiation",
          reasonCode: "ADAPTER_AUDIO_MODE_UNSUPPORTED",
          outcome: "unsatisfied",
          criticality: "critical",
          affectedIds: [resolvedProfile.audioMode],
          evidence: [],
          source: { kind: "adapter-capability", capabilityId: "audio-mode" },
        }),
      );
    }
    for (const scene of renderScenes) {
      if (scene.layers.length > caps.maximumLayerCountPerScene) {
        findings.push(
          mkFinding({
            stage: "capability-negotiation",
            reasonCode: "ADAPTER_SCENE_UNSUPPORTED",
            outcome: "unsatisfied",
            criticality: "critical",
            affectedIds: [scene.id],
            evidence: [{ kind: "layerCount", detail: String(scene.layers.length) }],
            source: { kind: "adapter-capability", capabilityId: "maximum-layer-count" },
          }),
        );
      }
    }

    const requiredCapabilityIds = sortedByCodePoint(
      [...new Set(renderScenes.flatMap((s) => [s.transitionIn?.requiredCapabilityId, s.transitionOut?.requiredCapabilityId].filter((x): x is string => Boolean(x))))],
      (x) => x,
    );

    // -----------------------------------------------------------------------
    // §20 Structurally valid canonical plan now exists (all reject() paths above
    // ran before this point). A structurally valid plan MAY still fail capability
    // negotiation — that becomes a Case B gate failure, not a Case A rejection.
    // -----------------------------------------------------------------------
    const provenance = provenanceBase();
    const planId = deterministicId(
      "render-plan",
      bundle.storyboardContentHash,
      resolvedProfileHash,
      bundle.adapterCapabilitiesHash,
      quantization.manifest.totalFrames,
    );
    const plan: RenderPlan = {
      schemaVersion: "0.1",
      id: planId,
      storyboardArtifactId: input.storyboardArtifactId,
      storyboardContentHash: bundle.storyboardContentHash,
      outputProfileSource: input.outputProfile,
      resolvedOutputProfile: resolvedProfile,
      timing: quantization.manifest,
      scenes: renderScenes,
      assetBindings,
      resolvedAssets,
      preparationRequirements,
      constraints,
      requiredCapabilityIds,
      provenance,
    };

    // -----------------------------------------------------------------------
    // §35 Non-critical override evaluation
    // -----------------------------------------------------------------------
    const blocking: RenderFinding[] = [];
    const warnings: RenderWarning[] = [];
    appliedOverrideIds = [];

    for (const finding of canonicalFindingOrder(findings)) {
      if (finding.outcome === "satisfied") continue;
      if (finding.criticality === "critical") {
        blocking.push(finding);
        continue;
      }
      const override = bundle.overrides.find((o) => o.findingId === finding.id);
      const allowlisted = OVERRIDE_ALLOWLISTED_REASON_CODES.has(finding.reasonCode);
      if (override && allowlisted && override.reasonCode === finding.reasonCode) {
        warnings.push({ id: deterministicId("warning", finding.id, override.id), findingId: finding.id, reasonCode: finding.reasonCode, affectedIds: finding.affectedIds, evidence: finding.evidence, appliedOverrideId: override.id });
        appliedOverrideIds.push(override.id);
      } else if (override && !allowlisted) {
        blocking.push(
          mkFinding({ stage: "override-evaluation", reasonCode: "OVERRIDE_NOT_ALLOWLISTED", outcome: "unsatisfied", criticality: "critical", affectedIds: [override.id], evidence: [], source: { kind: "override", overrideId: override.id } }),
        );
      } else if (DEFAULT_CONDITIONAL_REASON_CODES.has(finding.reasonCode)) {
        // §33: reason-registry default effect for these codes is conditional even
        // without an explicit override record.
        warnings.push({ id: deterministicId("warning", finding.id), findingId: finding.id, reasonCode: finding.reasonCode, affectedIds: finding.affectedIds, evidence: finding.evidence });
      } else {
        blocking.push(finding);
      }
    }

    for (const override of bundle.overrides) {
      const target = findings.find((f) => f.id === override.findingId);
      if (!target) {
        blocking.push(
          mkFinding({ stage: "override-evaluation", reasonCode: "OVERRIDE_INVALID", outcome: "unsatisfied", criticality: "critical", affectedIds: [override.id], evidence: [{ kind: "reason", detail: "findingId does not reference any produced finding" }], source: { kind: "override", overrideId: override.id } }),
        );
      } else if (target.criticality === "critical") {
        blocking.push(
          mkFinding({ stage: "override-evaluation", reasonCode: "OVERRIDE_INVALID", outcome: "unsatisfied", criticality: "critical", affectedIds: [override.id], evidence: [{ kind: "reason", detail: "override targets a critical finding" }], source: { kind: "override", overrideId: override.id } }),
        );
      }
    }

    const status: RenderGateStatus = blocking.length > 0 ? "fail" : warnings.length > 0 ? "conditional" : "pass";
    const requirementsBeforeRender = canonicalFindingOrder(blocking).map(requirementFor);

    const finalProvenance = provenanceBase();
    const gate: RenderGateResult = {
      schemaVersion: "0.1",
      name: "render",
      status,
      renderPlanArtifactId: planId,
      blockingFindings: canonicalFindingOrder(blocking),
      warnings: [...warnings].sort((a, b) => codePointCompare(a.id, b.id)),
      requirementsBeforeRender,
      appliedOverrideIds: sortedByCodePoint(appliedOverrideIds, (x) => x),
      provenance: finalProvenance,
    };

    this.lastMetrics = { inputArtifacts: 1, outputArtifacts: status === "fail" ? 2 : 3, warnings: warnings.length };

    return { kind: "compiled", plan: { ...plan, provenance: finalProvenance }, resolvedAssets, preparationRequirements, gate };
  }

  verify(output: RenderCompilationResult): VerificationResult {
    if (output.kind === "rejected") {
      return { ok: false, issues: output.rejection.findings.map((f) => ({ path: "findings", code: f.reasonCode, message: f.id })) };
    }
    if (output.gate.status === "fail") {
      return { ok: false, issues: output.gate.blockingFindings.map((f) => ({ path: "gate", code: f.reasonCode, message: f.id })) };
    }
    return { ok: true };
  }

  metrics(): EngineMetrics {
    return this.lastMetrics;
  }
}
