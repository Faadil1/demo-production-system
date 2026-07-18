// RFC-0006 — Renderer-Neutral Render Planning & Technical Render Gate. This file implements
// the normative contracts specified in
// docs/008-renderer-neutral-render-planning-and-technical-render-gate.md (sections 10-43,
// Appendix A/D). Field names and shapes intentionally mirror the RFC's contract blocks.
// These contracts are renderer-neutral: no adapter-specific (e.g. Remotion) types appear
// here, per §4/§49 invariant 27.

// ---------------------------------------------------------------------------
// §10 RenderCompilerInput
// ---------------------------------------------------------------------------

export type VersionedPolicyReference = {
  readonly id: string;
  readonly version: string;
};

export type RenderCompilerInput = {
  readonly schemaVersion: "0.1";
  readonly storyboardArtifactId: string;
  readonly expectedStoryboardContentHash: string;
  readonly outputProfile: RenderOutputProfileReference;
  readonly assetResolutionPolicy: VersionedPolicyReference;
  readonly transitionPolicy: VersionedPolicyReference;
  readonly layoutPolicy: VersionedPolicyReference;
  readonly adapterCapabilitiesArtifactId: string;
  readonly auxiliaryTrackArtifactIds: readonly string[];
  readonly overrideArtifactIds: readonly string[];
};

// ---------------------------------------------------------------------------
// §11 Output profile contract
// ---------------------------------------------------------------------------

export type Rational = {
  readonly numerator: number;
  readonly denominator: number;
};

export type FrameRate =
  | {
      readonly kind: "integer";
      readonly framesPerSecond: number;
    }
  | {
      readonly kind: "rational";
      readonly numerator: number;
      readonly denominator: number;
    };

export type RenderOutputProfileReference =
  | {
      readonly kind: "registered";
      readonly profileArtifactId: string;
      readonly expectedContentHash: string;
    }
  | {
      readonly kind: "inline-custom";
      readonly profile: RenderOutputProfile;
    };

export type RenderOutputProfile = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly version: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelAspectRatio: Rational;
  readonly frameRate: FrameRate;
  readonly colorSpace: "srgb" | "display-p3" | "rec709";
  readonly safeAreaInsetsPx: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly audioMode: "none" | "optional" | "required";
};

// ---------------------------------------------------------------------------
// §17 Source-agnostic asset provenance
// ---------------------------------------------------------------------------

export type RenderAssetSource =
  | {
      readonly kind: "browser-capture";
      readonly sourceArtifactId: string;
      readonly sourceItemId: string;
      readonly sourceRunId: string;
    }
  | {
      readonly kind: "artifact";
      readonly sourceArtifactId: string;
      readonly sourceItemId?: string;
    }
  | {
      readonly kind: "generated-auxiliary-track";
      readonly sourceArtifactId: string;
      readonly sourceItemId?: string;
    };

export type RenderMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "video/mp4"
  | "video/webm"
  | "audio/wav"
  | "audio/mp3"
  | "font/ttf"
  | "font/woff2";

// ---------------------------------------------------------------------------
// §15 Asset binding
// ---------------------------------------------------------------------------

export type RenderAssetBinding = {
  readonly id: string;
  readonly storyboardSceneId: string;
  readonly renderLayerId: string;
  readonly evidenceRefId: string;
  readonly role: "primary" | "supporting" | "background";
  readonly criticality: "required" | "optional";
  readonly acceptableMediaTypes: readonly RenderMediaType[];
  readonly selectionPolicy: VersionedPolicyReference;
};

// ---------------------------------------------------------------------------
// §18 Asset integrity / resolved asset
// ---------------------------------------------------------------------------

export type ResolvedRenderAsset = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly bindingId: string;
  readonly evidenceRefId: string;
  readonly source: RenderAssetSource;
  readonly sourceContentHash: string;
  readonly mediaType: RenderMediaType;
  readonly byteLength: number;
  readonly intrinsicWidthPx?: number;
  readonly intrinsicHeightPx?: number;
  readonly intrinsicDurationMs?: number;
  readonly preparedArtifactId?: string;
  readonly preparedContentHash?: string;
  readonly preparationRequirementIds: readonly string[];
};

// ---------------------------------------------------------------------------
// §19 Asset-preparation boundary
// ---------------------------------------------------------------------------

export type AssetPreparationOperation =
  | "resize-contain"
  | "resize-cover"
  | "lossless-normalize"
  | "transcode"
  | "crop-declared-region";

export type AssetPreparationRequirement = {
  readonly id: string;
  readonly bindingId: string;
  readonly operation: AssetPreparationOperation;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly required: boolean;
  readonly policy: VersionedPolicyReference;
};

// ---------------------------------------------------------------------------
// §20 RenderPlan / §Appendix A RenderTimingManifest
// ---------------------------------------------------------------------------

export type QuantizedBoundary = {
  readonly index: number;
  readonly exactNumerator: number;
  readonly exactDenominator: number;
  readonly quantizedFrame: number;
  readonly deltaNumerator: number;
  readonly deltaDenominator: number;
};

export type RenderTimingManifest = {
  readonly schemaVersion: "0.1";
  readonly frameRate: FrameRate;
  readonly quantizationPolicy: {
    readonly id: "cumulative-half-even";
    readonly version: "0.1";
  };
  readonly totalNarrativeDurationMs: number;
  readonly totalFrames: number;
  readonly boundaries: readonly QuantizedBoundary[];
};

// ---------------------------------------------------------------------------
// §14 Transitions
// ---------------------------------------------------------------------------

export type RenderTransitionKind =
  | "cut"
  | "hold"
  | "cross-reveal"
  | "replace"
  | "focus"
  | "continuity"
  | "before-after"
  | "proof-result"
  | "conclusion";

export type RenderTransition = {
  readonly id: string;
  readonly policy: VersionedPolicyReference;
  readonly kind: RenderTransitionKind;
  readonly sourceStoryIntent: string;
  readonly leftSceneId: string;
  readonly rightSceneId: string;
  readonly transitionWindowFrames: number;
  readonly requiredCapabilityId: string;
};

// ---------------------------------------------------------------------------
// §23 Geometry and coordinate system
// ---------------------------------------------------------------------------

export type RenderGeometry = {
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
};

export type FrameRange = {
  readonly startFrame: number;
  readonly endFrameExclusive: number;
};

// ---------------------------------------------------------------------------
// §26 Text source / §22 RenderLayer
// ---------------------------------------------------------------------------

export type RenderTextSource =
  | {
      readonly kind: "storyboard-authorized";
      readonly storyboardSceneId: string;
      readonly sourceField: "title" | "purpose";
    }
  | {
      readonly kind: "approved-variant";
      readonly auxiliaryArtifactId: string;
      readonly variantId: string;
    }
  | {
      readonly kind: "caption-cue";
      readonly auxiliaryArtifactId: string;
      readonly cueId: string;
    };

export type RenderLayerBase = {
  readonly id: string;
  readonly zIndex: number;
  readonly geometry: RenderGeometry;
  readonly activeFrameRange: FrameRange;
  readonly criticality: "required" | "optional";
  readonly styleTokenIds: readonly string[];
  readonly constraintIds: readonly string[];
};

export type RenderAssetLayer = RenderLayerBase & {
  readonly kind: "asset";
  readonly resolvedAssetId: string;
  readonly bindingId: string;
};

export type RenderTextLayer = RenderLayerBase & {
  readonly kind: "text";
  readonly source: RenderTextSource;
  readonly resolvedText: string;
  readonly resolvedFontSizePx: number;
  readonly usedVariantId?: string;
};

export type RenderShapeLayer = RenderLayerBase & {
  readonly kind: "shape";
  readonly shapeKind: "rectangle" | "rounded-rectangle" | "ellipse" | "line";
  readonly fillToken?: string;
  readonly strokeToken?: string;
};

export type RenderReservedRegionLayer = RenderLayerBase & {
  readonly kind: "reserved-region";
  readonly reservedFor: "caption" | "logo" | "safe-title" | "call-to-action";
};

export type RenderLayer = RenderAssetLayer | RenderTextLayer | RenderShapeLayer | RenderReservedRegionLayer;

export const LAYER_KIND_RANK: Readonly<Record<RenderLayer["kind"], number>> = {
  shape: 0,
  asset: 1,
  text: 2,
  "reserved-region": 3,
};

// ---------------------------------------------------------------------------
// §21 RenderScene
// ---------------------------------------------------------------------------

export type RenderScene = {
  readonly id: string;
  readonly storyboardSceneId: string;
  readonly storyboardSequenceId: string;
  readonly order: number;
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly durationFrames: number;
  readonly narrativeDurationMs: number;
  readonly transitionIn: RenderTransition | null;
  readonly transitionOut: RenderTransition | null;
  readonly layers: readonly RenderLayer[];
  readonly constraintIds: readonly string[];
  readonly requiredCapabilityIds: readonly string[];
};

// ---------------------------------------------------------------------------
// §31 Objective RenderConstraint model
// ---------------------------------------------------------------------------

export type RenderConstraintKind =
  | "bounds"
  | "safe-area"
  | "minimum-size"
  | "non-overlap"
  | "text-fit"
  | "required-region"
  | "timing"
  | "capability";

export type ConstraintBase = {
  readonly id: string;
  readonly kind: RenderConstraintKind;
  readonly targetIds: readonly string[];
  readonly criticality: "critical" | "non-critical";
  readonly policy: VersionedPolicyReference;
  readonly failureCode: RenderGateReasonCode;
};

export type BoundsConstraint = ConstraintBase & { readonly kind: "bounds" };
export type SafeAreaConstraint = ConstraintBase & { readonly kind: "safe-area" };
export type MinimumSizeConstraint = ConstraintBase & {
  readonly kind: "minimum-size";
  readonly minimumWidthPx: number;
  readonly minimumHeightPx: number;
};
export type NonOverlapConstraint = ConstraintBase & { readonly kind: "non-overlap" };
export type TextFitConstraint = ConstraintBase & { readonly kind: "text-fit" };
export type RequiredRegionConstraint = ConstraintBase & { readonly kind: "required-region" };
export type TimingConstraint = ConstraintBase & { readonly kind: "timing" };
export type CapabilityConstraint = ConstraintBase & { readonly kind: "capability" };

export type RenderConstraint =
  | BoundsConstraint
  | SafeAreaConstraint
  | MinimumSizeConstraint
  | NonOverlapConstraint
  | TextFitConstraint
  | RequiredRegionConstraint
  | TimingConstraint
  | CapabilityConstraint;

// ---------------------------------------------------------------------------
// §39 Provenance
// ---------------------------------------------------------------------------

export type RenderProvenance = {
  readonly schemaVersion: "0.1";
  readonly compiler: { readonly name: string; readonly version: string };
  readonly storyboardArtifactId: string;
  readonly storyboardSchemaVersion: string;
  readonly storyboardContentHash: string;
  readonly outputProfileSource: RenderOutputProfileReference;
  readonly resolvedOutputProfileId: string;
  readonly resolvedOutputProfileVersion: string;
  readonly resolvedOutputProfileHash: string;
  readonly adapterCapabilitiesArtifactId: string;
  readonly adapterVersion: string;
  readonly adapterCapabilitiesHash: string;
  readonly policies: readonly VersionedPolicyReference[];
  readonly dependencyArtifactIds: readonly string[];
  readonly appliedOverrideIds: readonly string[];
};

// ---------------------------------------------------------------------------
// §20 RenderPlan
// ---------------------------------------------------------------------------

export type RenderPlan = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly storyboardArtifactId: string;
  readonly storyboardContentHash: string;
  readonly outputProfileSource: RenderOutputProfileReference;
  readonly resolvedOutputProfile: RenderOutputProfile;
  readonly timing: RenderTimingManifest;
  readonly scenes: readonly RenderScene[];
  readonly assetBindings: readonly RenderAssetBinding[];
  readonly resolvedAssets: readonly ResolvedRenderAsset[];
  readonly preparationRequirements: readonly AssetPreparationRequirement[];
  readonly constraints: readonly RenderConstraint[];
  readonly requiredCapabilityIds: readonly string[];
  readonly provenance: RenderProvenance;
};

// ---------------------------------------------------------------------------
// §29 AdapterCapabilities
// ---------------------------------------------------------------------------

export type CapabilityRange = { readonly minimum: number; readonly maximum: number };

export type AdapterCapabilities = {
  readonly schemaVersion: "0.1";
  readonly adapter: { readonly name: string; readonly version: string };
  readonly declarationVersion: string;
  readonly supportedLayerKinds: readonly RenderLayer["kind"][];
  readonly supportedMediaTypes: readonly RenderMediaType[];
  readonly supportedTransitions: readonly RenderTransitionKind[];
  readonly supportedTypographyFeatures: readonly string[];
  readonly supportedEffects: readonly string[];
  readonly widthRangePx: CapabilityRange;
  readonly heightRangePx: CapabilityRange;
  readonly supportedFrameRates: readonly FrameRate[];
  readonly supportedColorSpaces: readonly RenderOutputProfile["colorSpace"][];
  readonly supportedAudioModes: readonly RenderOutputProfile["audioMode"][];
  readonly maximumLayerCountPerScene: number;
};

// ---------------------------------------------------------------------------
// §32 General RenderFinding
// ---------------------------------------------------------------------------

export type RenderFindingOutcome = "satisfied" | "unsatisfied";

export type RenderFindingSource =
  | { readonly kind: "entry"; readonly inputField?: string }
  | { readonly kind: "profile-resolution"; readonly profileId?: string }
  | { readonly kind: "auxiliary-track"; readonly artifactId?: string }
  | { readonly kind: "asset-binding"; readonly bindingId: string }
  | { readonly kind: "asset-resolution"; readonly bindingId: string; readonly candidateId?: string }
  | { readonly kind: "asset-integrity"; readonly candidateId: string }
  | { readonly kind: "asset-preparation"; readonly preparationRequirementId: string }
  | { readonly kind: "plan-structure"; readonly planElementId?: string }
  | { readonly kind: "timing"; readonly sceneId?: string; readonly boundaryIndex?: number }
  | { readonly kind: "transition"; readonly transitionId: string }
  | { readonly kind: "constraint"; readonly constraintId: string }
  | { readonly kind: "adapter-capability"; readonly capabilityId: string }
  | { readonly kind: "override"; readonly overrideId: string }
  | { readonly kind: "gate-aggregation"; readonly aggregationRuleId: string };

export type RenderFinding = {
  readonly id: string;
  readonly stage: RenderPipelineStage;
  readonly reasonCode: RenderGateReasonCode;
  readonly outcome: RenderFindingOutcome;
  readonly criticality: "critical" | "non-critical";
  readonly affectedIds: readonly string[];
  readonly evidence: readonly RenderFindingEvidence[];
  readonly source: RenderFindingSource;
};

export type RenderFindingEvidence = {
  readonly kind: string;
  readonly detail: string;
};

export type RenderConstraintFinding = RenderFinding & {
  readonly stage: "layout" | "timing" | "capability-negotiation";
  readonly source: { readonly kind: "constraint"; readonly constraintId: string };
};

// ---------------------------------------------------------------------------
// §32 Typed requirements / Render Gate
// ---------------------------------------------------------------------------

export type RenderAllowedNextAction =
  | "correct-render-input"
  | "resolve-upstream-story-requirement"
  | "restore-artifact"
  | "recapture-authorized-evidence"
  | "select-authoritative-asset"
  | "prepare-asset"
  | "select-output-profile"
  | "select-compatible-adapter"
  | "revise-versioned-policy"
  | "provide-approved-text-variant"
  | "compile-required-auxiliary-track"
  | "remove-invalid-override"
  | "retry-render-planning";

export type RenderRequirement = {
  readonly id: string;
  readonly reasonCode: RenderGateReasonCode;
  readonly allowedNextAction: RenderAllowedNextAction;
  readonly affectedIds: readonly string[];
};

export type RenderGateStatus = "pass" | "conditional" | "fail";

export type RenderWarning = {
  readonly id: string;
  readonly findingId: string;
  readonly reasonCode: RenderGateReasonCode;
  readonly affectedIds: readonly string[];
  readonly evidence: readonly RenderFindingEvidence[];
  readonly appliedOverrideId?: string;
};

export type RenderGateResult = {
  readonly schemaVersion: "0.1";
  readonly name: "render";
  readonly status: RenderGateStatus;
  readonly renderPlanArtifactId: string | null;
  readonly blockingFindings: readonly RenderFinding[];
  readonly warnings: readonly RenderWarning[];
  readonly requirementsBeforeRender: readonly RenderRequirement[];
  readonly appliedOverrideIds: readonly string[];
  readonly provenance: RenderProvenance;
};

// ---------------------------------------------------------------------------
// §35 Non-critical override policy
// ---------------------------------------------------------------------------

export type RenderOverrideRecord = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly findingId: string;
  readonly reasonCode: RenderGateReasonCode;
  readonly authority: { readonly kind: "human"; readonly authorityId: string };
  readonly rationale: string;
  readonly policy: VersionedPolicyReference;
  readonly createdAt: string;
  readonly reversible: true;
};

/**
 * v0.1 closed allowlist of reason codes eligible for non-critical override (§35). A code
 * not in this set can never be overridden, regardless of the finding's runtime
 * criticality classification — this is the "certain categories never overridable" rule.
 */
export const OVERRIDE_ALLOWLISTED_REASON_CODES: ReadonlySet<RenderGateReasonCode> = new Set([
  "OPTIONAL_ASSET_UNAVAILABLE",
  "OPTIONAL_ASSET_RECAPTURE_RECOMMENDED",
  "NON_CRITICAL_LAYOUT_DEGRADATION",
]);

// ---------------------------------------------------------------------------
// §36 Failure taxonomy
// ---------------------------------------------------------------------------

export type RenderGateReasonCode =
  | "RENDER_COMPILER_INPUT_INVALID"
  | "STORY_GATE_INELIGIBLE"
  | "STORY_GATE_REQUIREMENT_NOT_RENDERER_BOUND"
  | "STORYBOARD_NOT_FOUND"
  | "STORYBOARD_HASH_MISMATCH"
  | "STORYBOARD_REFERENCE_INVALID"
  | "DEPENDENCY_ARTIFACT_NOT_FOUND"
  | "OUTPUT_PROFILE_NOT_FOUND"
  | "OUTPUT_PROFILE_HASH_MISMATCH"
  | "OUTPUT_PROFILE_INVALID"
  | "OUTPUT_PROFILE_CONTRADICTORY"
  | "OUTPUT_PROFILE_UNSUPPORTED"
  | "REQUIRED_AUXILIARY_TRACK_MISSING"
  | "REQUIRED_AUXILIARY_TRACK_INVALID"
  | "RENDER_PLAN_STRUCTURALLY_INVALID"
  | "REQUIRED_LAYER_UNREALIZABLE"
  | "TIMING_ALLOCATION_IMPOSSIBLE"
  | "FRAME_ROUNDING_INVARIANT_FAILED"
  | "TRANSITION_POLICY_UNRESOLVED"
  | "TRANSITION_OVERLAP_INVALID"
  | "ASSET_BINDING_UNRESOLVED"
  | "ASSET_MISSING"
  | "ASSET_AUTHORITATIVE_CANDIDATE_AMBIGUOUS"
  | "ASSET_HASH_MISMATCH"
  | "ASSET_CORRUPT"
  | "ASSET_FORMAT_UNSUPPORTED"
  | "ASSET_STALE"
  | "ASSET_PREPARATION_FAILED"
  | "CONTENT_OUT_OF_FRAME"
  | "SAFE_AREA_VIOLATION"
  | "MINIMUM_SIZE_VIOLATION"
  | "REQUIRED_ELEMENTS_OVERLAP"
  | "RESERVED_REGION_MISSING"
  | "TEXT_OVERFLOW"
  | "ADAPTER_CAPABILITIES_NOT_FOUND"
  | "ADAPTER_CAPABILITIES_HASH_MISMATCH"
  | "ADAPTER_CAPABILITIES_INVALID"
  | "ADAPTER_LAYER_UNSUPPORTED"
  | "ADAPTER_SCENE_UNSUPPORTED"
  | "ADAPTER_TRANSITION_UNSUPPORTED"
  | "ADAPTER_TYPOGRAPHY_UNSUPPORTED"
  | "ADAPTER_MEDIA_TYPE_UNSUPPORTED"
  | "ADAPTER_DIMENSIONS_UNSUPPORTED"
  | "ADAPTER_TIMEBASE_UNSUPPORTED"
  | "ADAPTER_COLOR_SPACE_UNSUPPORTED"
  | "ADAPTER_AUDIO_MODE_UNSUPPORTED"
  | "OPTIONAL_ASSET_UNAVAILABLE"
  | "OPTIONAL_ASSET_RECAPTURE_RECOMMENDED"
  | "NON_CRITICAL_LAYOUT_DEGRADATION"
  | "OVERRIDE_INVALID"
  | "OVERRIDE_NOT_ALLOWLISTED";

/** §43: post-render-only codes. MUST NOT enter the Render Gate (invariant 26). */
export type PostRenderReasonCode =
  | "RENDERED_FRAME_COUNT_MISMATCH"
  | "RENDERED_OUTPUT_DECODE_FAILURE"
  | "RENDERED_DIMENSION_MISMATCH"
  | "BLACK_OR_EMPTY_REQUIRED_FRAME"
  | "MISSING_RENDERED_LAYER"
  | "AUDIO_VIDEO_DURATION_MISMATCH"
  | "CONTAINER_INVALID"
  | "EXPORT_CODEC_MISMATCH"
  | "POST_RENDER_SAFE_AREA_VIOLATION";

export type PostRenderValidationRequest = {
  readonly schemaVersion: "0.1";
  readonly renderPlanArtifactId: string;
  readonly renderedOutputArtifactId: string;
  readonly expectedTotalFrames: number;
  readonly expectedOutputProfile: RenderOutputProfile;
};

// ---------------------------------------------------------------------------
// §40 Artifact emission — Case A
// ---------------------------------------------------------------------------

export type RenderRejection = {
  readonly schemaVersion: "0.1";
  readonly status: "rejected";
  readonly stage: RenderPipelineStage;
  readonly reasonCodes: readonly RenderGateReasonCode[];
  readonly findings: readonly RenderFinding[];
  readonly requirements: readonly RenderRequirement[];
  readonly inputArtifactIds: readonly string[];
  readonly provenance: RenderProvenance;
};

// ---------------------------------------------------------------------------
// Appendix A pipeline stage enumeration
// ---------------------------------------------------------------------------

export type RenderPipelineStage =
  | "entry"
  | "profile-resolution"
  | "auxiliary-track-resolution"
  | "asset-binding"
  | "asset-resolution"
  | "asset-integrity"
  | "asset-preparation"
  | "plan-compilation"
  | "timing"
  | "transition"
  | "layout"
  | "capability-negotiation"
  | "override-evaluation"
  | "gate-aggregation";

export const PIPELINE_STAGE_RANK: Readonly<Record<RenderPipelineStage, number>> = {
  entry: 0,
  "profile-resolution": 1,
  "auxiliary-track-resolution": 2,
  "asset-binding": 3,
  "asset-resolution": 4,
  "asset-integrity": 5,
  "asset-preparation": 6,
  "plan-compilation": 7,
  timing: 8,
  transition: 9,
  layout: 10,
  "capability-negotiation": 11,
  "override-evaluation": 12,
  "gate-aggregation": 13,
};

// ---------------------------------------------------------------------------
// §27 Approved text variants
// ---------------------------------------------------------------------------

export type ApprovedTextVariant = {
  readonly id: string;
  readonly authoritativePriority: number;
  readonly textSourceArtifactId: string;
  readonly textSourceItemId: string;
  readonly text: string;
};

// ---------------------------------------------------------------------------
// Appendix D reference output profile
// ---------------------------------------------------------------------------

export const DPS_LANDSCAPE_1080P30_V01: RenderOutputProfile = {
  schemaVersion: "0.1",
  id: "dps-landscape-1080p30",
  version: "0.1",
  widthPx: 1920,
  heightPx: 1080,
  pixelAspectRatio: { numerator: 1, denominator: 1 },
  frameRate: { kind: "integer", framesPerSecond: 30 },
  colorSpace: "srgb",
  safeAreaInsetsPx: {
    top: 54,
    right: 96,
    bottom: 54,
    left: 96,
  },
  audioMode: "optional",
};
