import { createHash } from "node:crypto";
import type { Storyboard, StoryScene } from "../../src/core/story.js";
import { canonicalHash, normalizeAdapterCapabilities } from "../../src/core/render-canonical.js";
import { DPS_LANDSCAPE_1080P30_V01, ENTRY_REQUIREMENT_CLASSIFICATION_POLICY, type AdapterCapabilities, type EntryRequirementClassification, type RenderCompilerInput } from "../../src/core/render.js";
import type { RenderAssetCandidateRecord, RenderBindingRequest, RenderCompilerBundle, RenderTextLayerRequest } from "../../src/core/render-input.js";

// A 1x1 red PNG, base64-encoded — a genuine minimal valid PNG byte stream.
export const ONE_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
export const ONE_PX_PNG_HASH = createHash("sha256").update(Buffer.from(ONE_PX_PNG_BASE64, "base64")).digest("hex");
export const ONE_PX_PNG_LENGTH = Buffer.from(ONE_PX_PNG_BASE64, "base64").length;

function scene(args: {
  readonly id: string;
  readonly order: number;
  readonly durationTargetMs: number;
  readonly sequenceId?: string;
  readonly title?: string;
  readonly purpose?: string;
}): StoryScene {
  return {
    schemaVersion: "0.1",
    id: args.id,
    title: args.title ?? `Scene ${args.id}`,
    purpose: args.purpose ?? `Purpose of ${args.id}`,
    beatIds: [`beat-${args.id}`],
    primaryBeatId: `beat-${args.id}`,
    sequenceId: args.sequenceId ?? "sequence-1",
    order: args.order,
    priority: "critical",
    durationTargetMs: args.durationTargetMs,
    durationRangeMs: { minimum: 500, maximum: 10000 },
    requiredEvidenceRefs: args.id === "scene-a" ? ["ev-1", "ev-missing", "ev-optional-missing", "ev-x", "ev-missing-required"] : [],
    requiredClaimIds: [],
    requiredObservationIds: [],
    mustAppear: true,
    mustNotAppearWith: [],
    dependsOnSceneIds: [],
    supportsSceneIds: [],
    transitionIn: "cut",
    transitionOut: "cut",
    presentationIntent: {
      visualRole: "establish",
      framing: "full-context",
      textIntent: "label",
      voiceIntent: "context",
      motionIntent: "static",
      artifactPreference: "no-preference",
    },
    confidence: 0.9,
    whyThisSceneExists: "fixture",
    rejectionRisk: [],
  };
}

export function minimalStoryboard(scenes: readonly StoryScene[]): Storyboard {
  return {
    schemaVersion: "0.1",
    id: "storyboard-fixture",
    sourceArtifactIds: ["product-understanding", "dir"],
    storyMode: "promotional",
    audience: {
      role: "unspecified",
      familiarity: "aware",
      technicalDepth: "medium",
      primaryQuestion: "unspecified",
      decisionContext: "unspecified",
      knownConstraints: [],
    },
    objective: "explain",
    narrativeArc: "problem-solution-proof",
    beats: [],
    scenes,
    sequences: [
      { id: "sequence-1", kind: "demonstration", purpose: "demo", sceneIds: scenes.map((s) => s.id), order: 0, durationBudgetMs: scenes.reduce((s, x) => s + x.durationTargetMs, 0), required: true, completionCriteria: [] },
    ],
    heroInteraction: null,
    proofChains: [],
    durationBudget: { targetMs: 4000, minimumMs: 2000, maximumMs: 10000, allocatedMs: 4000, unallocatedMs: 0, overBudgetMs: 0, compressionApplied: false },
    coverage: {
      requiredClaimCount: 0,
      coveredClaimCount: 0,
      criticalClaimCount: 0,
      coveredCriticalClaimCount: 0,
      requiredBeatCount: 0,
      satisfiedBeatCount: 0,
      verifiedProofChainCount: 0,
      partialProofChainCount: 0,
      unsupportedClaimCount: 0,
      unverifiedImpactBeatsAdmittedCount: 0,
      heroInteractionCovered: true,
      resultCovered: true,
      ctaRequired: false,
      ctaCovered: false,
      narrativeCoverageRatio: 1,
      proofCoverageRatio: 1,
      sufficient: true,
    },
    rendererReadiness: { status: "ready", readySceneIds: scenes.map((s) => s.id), recaptureRequiredSceneIds: [], blockedSceneIds: [], missingArtifactIds: [], recaptureRequirements: [], reasons: [] },
    rejectedCandidates: [],
    decisions: [],
    gate: { status: "pass", blockingReasons: [], warnings: [], requirementsBeforeRender: [] },
    metrics: {
      narrativeCompleteness: 1,
      proofDensity: 1,
      evidenceUtilization: 1,
      redundancy: 0,
      setupRatio: 0.2,
      interactionRatio: 0.5,
      proofRatio: 0.2,
      resultRatio: 0.1,
      unsupportedClaimCount: 0,
      transitionCoherence: 1,
      sceneCount: scenes.length,
      sequenceCount: 1,
      durationFit: 1,
      heroInteractionContinuity: "absent",
      rejectionCountByReason: {},
    },
  };
}

export function twoSceneStoryboard(): Storyboard {
  return minimalStoryboard([
    scene({ id: "scene-a", order: 0, durationTargetMs: 2000 }),
    scene({ id: "scene-b", order: 1, durationTargetMs: 2000 }),
  ]);
}

export function defaultAdapterCapabilities(overrides: Partial<AdapterCapabilities> = {}): AdapterCapabilities {
  return {
    schemaVersion: "0.1",
    adapter: { name: "reference-adapter", version: "0.1.0" },
    declarationVersion: "0.1",
    supportedLayerKinds: ["asset", "text", "shape", "reserved-region"],
    supportedMediaTypes: ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "audio/wav", "audio/mp3"],
    supportedTransitions: ["cut", "hold", "cross-reveal", "replace", "focus", "continuity", "before-after", "proof-result", "conclusion"],
    supportedTypographyFeatures: [],
    supportedEffects: [],
    widthRangePx: { minimum: 100, maximum: 4096 },
    heightRangePx: { minimum: 100, maximum: 4096 },
    supportedFrameRates: [{ kind: "integer", framesPerSecond: 30 }],
    supportedColorSpaces: ["srgb", "display-p3", "rec709"],
    supportedAudioModes: ["none", "optional", "required"],
    maximumLayerCountPerScene: 10,
    ...overrides,
  };
}

export function entryRequirementClassification(args: {
  readonly storyboardArtifactId: string;
  readonly storyboardContentHash: string;
  readonly requirementIndex: number;
  readonly requirement: string;
  readonly classification: EntryRequirementClassification["classification"];
}): EntryRequirementClassification {
  return {
    storyboardArtifactId: args.storyboardArtifactId,
    storyboardContentHash: args.storyboardContentHash,
    requirementIndex: args.requirementIndex,
    requirementHash: canonicalHash(args.requirement),
    classification: args.classification,
    policy: ENTRY_REQUIREMENT_CLASSIFICATION_POLICY,
  };
}

export function defaultInput(overrides: Partial<RenderCompilerInput> = {}): RenderCompilerInput {
  return {
    schemaVersion: "0.1",
    storyboardArtifactId: "storyboard-fixture",
    expectedStoryboardContentHash: "placeholder",
    outputProfile: { kind: "registered", profileArtifactId: "dps-landscape-1080p30", expectedContentHash: canonicalHash(DPS_LANDSCAPE_1080P30_V01) },
    assetResolutionPolicy: { id: "default-asset-policy", version: "0.1" },
    transitionPolicy: { id: "minimal-transition-policy", version: "0.1" },
    layoutPolicy: { id: "minimal-layout-policy", version: "0.1" },
    entryRequirementClassifications: [],
    adapterCapabilitiesArtifactId: "adapter-capabilities-fixture",
    auxiliaryTrackArtifactIds: [],
    overrideArtifactIds: [],
    ...overrides,
  };
}

export function buildBundle(args: {
  readonly storyboard: Storyboard;
  readonly adapterCapabilities?: AdapterCapabilities;
  readonly assetCandidates?: readonly RenderAssetCandidateRecord[];
  readonly assetBindingRequests?: readonly RenderBindingRequest[];
  readonly textLayerRequests?: readonly RenderTextLayerRequest[];
  readonly overrides?: RenderCompilerBundle["overrides"];
  readonly inputOverrides?: Partial<RenderCompilerInput>;
}): RenderCompilerBundle {
  const adapterCapabilities = args.adapterCapabilities ?? defaultAdapterCapabilities();
  const storyboardContentHash = canonicalHash(args.storyboard);
  const input = defaultInput({ expectedStoryboardContentHash: storyboardContentHash, ...args.inputOverrides });
  return {
    input,
    storyboard: args.storyboard,
    storyboardContentHash,
    adapterCapabilities,
    adapterCapabilitiesHash: canonicalHash(normalizeAdapterCapabilities(adapterCapabilities)),
    assetCandidates: args.assetCandidates ?? [],
    assetBindingRequests: args.assetBindingRequests ?? [],
    textLayerRequests: args.textLayerRequests ?? [],
    overrides: args.overrides ?? [],
  };
}
