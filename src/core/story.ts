import type { DecisionOption } from "./decision.js";
import type { ISODateTime, RunId } from "./types.js";
import type { VerificationStatus } from "./provenance.js";
import type { ProductUnderstanding } from "./product-understanding.js";
import type { DemoIntermediateRepresentation } from "./dir.js";
import type { ExistingDemoAnalysis } from "./existing-demo-analysis.js";
import type { BrowserCaptureResult } from "./browser-capture-result.js";

// RFC-0005 — Story Engine & Storyboard Compiler. This file implements the contracts
// specified in docs/007-story-engine-and-storyboard-compiler.md (sections 6-27). Field
// names and shapes intentionally mirror the RFC's "DRAFT CONTRACT" blocks. Where the RFC
// leaves an implementation detail open (weights, exact evidence-to-claim linkage), the
// choice is documented inline and in docs/implementation/rfc-0005-implementation.md.

// ---------------------------------------------------------------------------
// §6-7 Narrative beat model
// ---------------------------------------------------------------------------

export type NarrativeBeatKind =
  | "hook"
  | "audience-context"
  | "problem"
  | "consequence"
  | "current-state"
  | "goal"
  | "product-introduction"
  | "mechanism"
  | "interaction-start"
  | "interaction-progress"
  | "interaction-complete"
  | "proof"
  | "comparison"
  | "result"
  | "impact"
  | "trust"
  | "limitation"
  | "next-step"
  | "call-to-action";

export type NarrativeBeat = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly kind: NarrativeBeatKind;
  readonly purpose: string;
  readonly audienceTakeaway: string;
  readonly sourceClaimIds: readonly string[];
  readonly sourceFactIds: readonly string[];
  readonly evidenceRefs: readonly StoryEvidenceReference[];
  readonly requiredObservationIds: readonly string[];
  readonly confidence: number;
  readonly importance: "supporting" | "important" | "critical";
  readonly verificationStatus: VerificationStatus;
  readonly uncertaintyNotes: readonly string[];
  readonly mustAppear: boolean;
  readonly dependencies: readonly string[];
  readonly conflictsWith: readonly string[];
};

// ---------------------------------------------------------------------------
// §8 Story evidence references
// ---------------------------------------------------------------------------

export type StoryEvidenceSourceType =
  | "understanding-evidence"
  | "browser-assertion"
  | "browser-screenshot"
  | "browser-dom"
  | "capture-observation"
  | "analysis-observation"
  | "analysis-finding"
  | "dir-requirement"
  | "decision-record";

export type StoryEvidenceRole = "context" | "cause" | "interaction" | "proof" | "result" | "limitation";

export type StoryEvidenceReference = {
  readonly id: string;
  readonly sourceType: StoryEvidenceSourceType;
  readonly sourceArtifactId: string;
  readonly sourceItemId: string;
  readonly sourceRunId: string;
  readonly verificationStatus: VerificationStatus;
  readonly role: StoryEvidenceRole;
};

/**
 * §8 evidence eligibility rules, applied per candidate role. Returns false whenever the
 * reference cannot legally support the requested role.
 */
export function isEvidenceEligibleForRole(ref: StoryEvidenceReference, role: StoryEvidenceRole): boolean {
  if (role === "proof") {
    if (ref.sourceType === "browser-screenshot") return false;
    if (ref.sourceType === "analysis-finding") return false;
    if (ref.sourceType === "understanding-evidence" && ref.verificationStatus === "unverified") return false;
    if (ref.verificationStatus === "unverified") return false;
    return true;
  }
  if (role === "result") {
    if (ref.sourceType === "browser-screenshot") return false;
    if (ref.verificationStatus === "unverified") return false;
    return true;
  }
  if (role === "cause") {
    if (ref.verificationStatus === "unverified" && ref.sourceType !== "capture-observation") return false;
    return true;
  }
  if (role === "context") {
    return true;
  }
  if (role === "limitation") {
    return true;
  }
  if (role === "interaction") {
    return ref.sourceType !== "analysis-finding";
  }
  return true;
}

// ---------------------------------------------------------------------------
// §10-11 Presentation and transition intent
// ---------------------------------------------------------------------------

export type ScenePresentationIntent = {
  readonly visualRole: "establish" | "demonstrate" | "compare" | "prove" | "resolve" | "conclude";
  readonly framing:
    | "full-context"
    | "focused-element"
    | "before-after"
    | "side-by-side"
    | "progressive-reveal"
    | "persistent-context";
  readonly textIntent: "none" | "label" | "explanation" | "metric" | "warning" | "CTA";
  readonly voiceIntent: "none" | "context" | "explanation" | "emphasis" | "transition" | "conclusion";
  readonly motionIntent: "static" | "focus" | "reveal" | "replace" | "compare" | "track" | "hold";
  readonly artifactPreference:
    | "screenshot"
    | "DOM-derived"
    | "browser-recapture"
    | "generated-diagram"
    | "renderer-native"
    | "no-preference";
};

export type StoryTransitionIntent =
  | "cut"
  | "hold"
  | "reveal"
  | "replace"
  | "compare"
  | "focus"
  | "zoom-intent"
  | "continuity"
  | "cause-to-effect"
  | "before-to-after"
  | "proof-to-result"
  | "conclusion";

// ---------------------------------------------------------------------------
// §9 Scene model
// ---------------------------------------------------------------------------

export type StoryScene = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly beatIds: readonly string[];
  readonly primaryBeatId: string;
  readonly sequenceId: string;
  readonly order: number;
  readonly priority: "supporting" | "important" | "critical";
  readonly durationTargetMs: number;
  readonly durationRangeMs: { readonly minimum: number; readonly maximum: number };
  readonly requiredEvidenceRefs: readonly string[];
  readonly requiredClaimIds: readonly string[];
  readonly requiredObservationIds: readonly string[];
  readonly mustAppear: boolean;
  readonly mustNotAppearWith: readonly string[];
  readonly dependsOnSceneIds: readonly string[];
  readonly supportsSceneIds: readonly string[];
  readonly transitionIn: StoryTransitionIntent;
  readonly transitionOut: StoryTransitionIntent;
  readonly presentationIntent: ScenePresentationIntent;
  readonly confidence: number;
  readonly whyThisSceneExists: string;
  readonly rejectionRisk: readonly string[];
};

// ---------------------------------------------------------------------------
// §12 Sequence model
// ---------------------------------------------------------------------------

export type StorySequenceKind =
  | "opening"
  | "context"
  | "problem"
  | "mechanism"
  | "demonstration"
  | "proof"
  | "outcome"
  | "conclusion";

export type StorySequence = {
  readonly id: string;
  readonly kind: StorySequenceKind;
  readonly purpose: string;
  readonly sceneIds: readonly string[];
  readonly order: number;
  readonly durationBudgetMs: number;
  readonly required: boolean;
  readonly completionCriteria: readonly string[];
};

// ---------------------------------------------------------------------------
// §14 Audience and objective
// ---------------------------------------------------------------------------

export type StoryAudience = {
  readonly role: string;
  readonly familiarity: "unfamiliar" | "aware" | "experienced";
  readonly technicalDepth: "low" | "medium" | "high";
  readonly primaryQuestion: string;
  readonly decisionContext: string;
  readonly knownConstraints: readonly string[];
};

export const DEFAULT_STORY_AUDIENCE: StoryAudience = {
  role: "unspecified",
  familiarity: "aware",
  technicalDepth: "medium",
  primaryQuestion: "unspecified",
  decisionContext: "unspecified",
  knownConstraints: [],
};

export type StoryObjective =
  | "explain"
  | "demonstrate"
  | "prove"
  | "compare"
  | "persuade-to-try"
  | "persuade-to-review"
  | "persuade-to-buy"
  | "document";

export const PERSUASIVE_OBJECTIVES: readonly StoryObjective[] = [
  "persuade-to-try",
  "persuade-to-review",
  "persuade-to-buy",
];

// ---------------------------------------------------------------------------
// §15 Narrative arc model
// ---------------------------------------------------------------------------

export type NarrativeArc =
  | "problem-solution-proof"
  | "before-interaction-after"
  | "goal-obstacle-resolution"
  | "diagnosis-intervention-result"
  | "workflow-friction-compression"
  | "claim-demonstration-verification"
  | "comparison-decision"
  | "capability-example-impact";

/** §15: required beat kinds in order, per arc. Selection tie-break order matches this list. */
export const NARRATIVE_ARCS: readonly { readonly arc: NarrativeArc; readonly requiredBeats: readonly NarrativeBeatKind[] }[] = [
  {
    arc: "problem-solution-proof",
    requiredBeats: ["problem", "product-introduction", "interaction-start", "interaction-complete", "proof", "result"],
  },
  {
    arc: "before-interaction-after",
    requiredBeats: ["current-state", "interaction-start", "interaction-complete", "comparison", "result"],
  },
  {
    arc: "goal-obstacle-resolution",
    requiredBeats: ["goal", "problem", "interaction-start", "interaction-complete", "result"],
  },
  {
    arc: "diagnosis-intervention-result",
    requiredBeats: ["current-state", "mechanism", "interaction-start", "interaction-complete", "result"],
  },
  {
    arc: "workflow-friction-compression",
    requiredBeats: ["problem", "interaction-start", "interaction-complete", "comparison", "result"],
  },
  {
    arc: "claim-demonstration-verification",
    requiredBeats: ["product-introduction", "mechanism", "interaction-start", "interaction-complete", "proof"],
  },
  {
    arc: "comparison-decision",
    requiredBeats: ["problem", "comparison", "interaction-start", "interaction-complete", "proof", "result"],
  },
  {
    arc: "capability-example-impact",
    requiredBeats: ["product-introduction", "mechanism", "interaction-start", "interaction-complete", "result", "impact"],
  },
];

// ---------------------------------------------------------------------------
// §16 Hero Interaction Sequence
// ---------------------------------------------------------------------------

export type HeroNarrativeAuthority = "human-selected" | "policy-selected" | "analysis-derived";
export type HeroContinuityStatus = "complete" | "partial" | "broken";
export type HeroVerificationStatus = "verified" | "partially-verified" | "unverified" | "unverifiable";

export type HeroInteractionSequence = {
  readonly id: string;
  readonly sourceHeroInteractionId: string;
  readonly narrativeAuthority: HeroNarrativeAuthority;
  readonly startSceneId: string;
  readonly progressSceneIds: readonly string[];
  readonly completionSceneId: string;
  readonly proofSceneIds: readonly string[];
  readonly resultSceneId: string | null;
  readonly continuityStatus: HeroContinuityStatus;
  readonly verificationStatus: HeroVerificationStatus;
  readonly alternativeVerifiedInteractionIds: readonly string[];
  readonly confidence: number;
};

// ---------------------------------------------------------------------------
// §17 Proof chain
// ---------------------------------------------------------------------------

export type ProofChainStatus = "verified" | "partial" | "unsupported";

export type ProofChain = {
  readonly id: string;
  readonly claimId: string;
  readonly contextSceneIds: readonly string[];
  readonly actionSceneIds: readonly string[];
  readonly evidenceRefIds: readonly string[];
  readonly sourceAssertionIds: readonly string[];
  readonly sourceArtifactIds: readonly string[];
  readonly proofSceneIds: readonly string[];
  readonly resultSceneIds: readonly string[];
  readonly status: ProofChainStatus;
  readonly gaps: readonly string[];
};

// ---------------------------------------------------------------------------
// §18 Duration budget
// ---------------------------------------------------------------------------

export type StoryDurationBudget = {
  readonly targetMs: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly allocatedMs: number;
  readonly unallocatedMs: number;
  readonly overBudgetMs: number;
  readonly compressionApplied: boolean;
};

export const MINIMUM_READABLE_SCENE_MS = 1500;
export const MAX_SETUP_PROPORTION = 0.25;
export const MIN_HERO_PROPORTION = 0.2;
export const MIN_PROOF_PROPORTION = 0.15;
export const MAX_CTA_PROPORTION = 0.1;

// ---------------------------------------------------------------------------
// §20 Selection / rejection
// ---------------------------------------------------------------------------

export type RejectionReasonCode =
  | "unsupported"
  | "duplicate"
  | "low-confidence"
  | "non-critical"
  | "duration-budget"
  | "dependency-missing"
  | "conflicts-with-hero"
  | "sequencing-invalid"
  | "audience-mismatch"
  | "claim-not-required"
  | "stronger-evidence-selected"
  | "incomplete-proof-chain"
  | "forbidden-in-current-arc"
  | "unsupported-impact"
  | "capture-conflict-unresolved";

export type RejectedStoryCandidate = {
  readonly id: string;
  readonly candidateType: "beat" | "scene";
  readonly candidateSnapshot: unknown;
  readonly reasonCode: RejectionReasonCode;
  readonly explanation: string;
  readonly conflictingWithIds: readonly string[];
  readonly replacedByIds: readonly string[];
};

// ---------------------------------------------------------------------------
// §21 Story decisions
// ---------------------------------------------------------------------------

export type StoryDecision = {
  readonly decisionId: string;
  readonly runId: RunId;
  readonly createdAt: ISODateTime;
  readonly engine: "story-engine";
  readonly question: string;
  readonly options: readonly DecisionOption[];
  readonly chosenOptionId: string;
  readonly reason: string;
  readonly confidence: number;
  readonly authority: "human" | "engine" | "policy";
  readonly reversible: boolean;
  readonly reasonCodes: readonly string[];
};

// ---------------------------------------------------------------------------
// §23-24 Coverage and metrics
// ---------------------------------------------------------------------------

export type StoryCoverage = {
  readonly requiredClaimCount: number;
  readonly coveredClaimCount: number;
  readonly criticalClaimCount: number;
  readonly coveredCriticalClaimCount: number;
  readonly requiredBeatCount: number;
  readonly satisfiedBeatCount: number;
  readonly verifiedProofChainCount: number;
  readonly partialProofChainCount: number;
  readonly unsupportedClaimCount: number;
  readonly unverifiedImpactBeatsAdmittedCount: number;
  readonly heroInteractionCovered: boolean;
  readonly resultCovered: boolean;
  readonly ctaRequired: boolean;
  readonly ctaCovered: boolean;
  readonly narrativeCoverageRatio: number;
  readonly proofCoverageRatio: number;
  readonly sufficient: boolean;
};

export type StoryMetrics = {
  readonly narrativeCompleteness: number;
  readonly proofDensity: number;
  readonly evidenceUtilization: number;
  readonly redundancy: number;
  readonly setupRatio: number;
  readonly interactionRatio: number;
  readonly proofRatio: number;
  readonly resultRatio: number;
  readonly unsupportedClaimCount: number;
  readonly transitionCoherence: number;
  readonly sceneCount: number;
  readonly sequenceCount: number;
  readonly durationFit: number;
  readonly heroInteractionContinuity: "complete" | "partial" | "broken" | "absent";
  readonly rejectionCountByReason: Partial<Record<RejectionReasonCode, number>>;
};

// ---------------------------------------------------------------------------
// §9a / §25 Renderer readiness and Story Gate
// ---------------------------------------------------------------------------

export type RendererReadinessStatus = "ready" | "recapture-required" | "blocked";

export type RendererReadiness = {
  readonly status: RendererReadinessStatus;
  readonly readySceneIds: readonly string[];
  readonly recaptureRequiredSceneIds: readonly string[];
  readonly blockedSceneIds: readonly string[];
  readonly missingArtifactIds: readonly string[];
  readonly recaptureRequirements: readonly string[];
  readonly reasons: readonly string[];
};

export type StoryGateFailureCategory =
  | "invalid-input"
  | "insufficient-evidence"
  | "incomplete-narrative"
  | "duration-infeasibility"
  | "unsupported-claim"
  | "structural-failure"
  | "renderer-readiness-failure";

export type StoryGateStatus = "pass" | "conditional" | "fail";

export type StoryGate = {
  readonly status: StoryGateStatus;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly requirementsBeforeRender: readonly string[];
};

/** Prefix used to encode §25 failure-category taxonomy onto a blockingReasons string. */
export function classifiedReason(category: StoryGateFailureCategory, message: string): string {
  return `[${category}] ${message}`;
}

// ---------------------------------------------------------------------------
// §13 Storyboard
// ---------------------------------------------------------------------------

export type StoryMode = "promotional" | "diagnostic";

export type Storyboard = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly sourceArtifactIds: readonly string[];
  readonly storyMode: StoryMode;
  readonly audience: StoryAudience;
  readonly objective: StoryObjective;
  readonly narrativeArc: NarrativeArc | null;
  readonly beats: readonly NarrativeBeat[];
  readonly scenes: readonly StoryScene[];
  readonly sequences: readonly StorySequence[];
  readonly heroInteraction: HeroInteractionSequence | null;
  readonly proofChains: readonly ProofChain[];
  readonly durationBudget: StoryDurationBudget;
  readonly coverage: StoryCoverage;
  readonly rendererReadiness: RendererReadiness;
  readonly rejectedCandidates: readonly RejectedStoryCandidate[];
  readonly decisions: readonly StoryDecision[];
  readonly gate: StoryGate;
  readonly metrics: StoryMetrics;
};

// ---------------------------------------------------------------------------
// §26 Upstream gate policy / capture selection
// ---------------------------------------------------------------------------

export type BrowserCaptureSelectionPolicy = {
  readonly authoritativeRunId?: string;
  readonly fallback: "latest-captured-at" | "highest-gate-status" | "reject-conflict";
};

export const DEFAULT_CAPTURE_SELECTION_POLICY: BrowserCaptureSelectionPolicy = {
  fallback: "latest-captured-at",
};

/**
 * One supplied browser capture run plus the run-identity metadata RFC-0005 needs
 * (`runId`, `capturedAt`) that RFC-0004's `BrowserCaptureResult` itself does not carry —
 * that metadata lives on the RFC-0001 `ArtifactEnvelope` that wraps a capture result in
 * the filesystem registry. The Story Engine input contract makes it explicit here so the
 * compiler stays a pure function over plain data (§28).
 */
export type BrowserCaptureRunInput = {
  readonly runId: string;
  readonly artifactId: string;
  readonly capturedAt: ISODateTime;
  readonly result: BrowserCaptureResult;
};

// ---------------------------------------------------------------------------
// §27 Input contract
// ---------------------------------------------------------------------------

export type StoryConstraint =
  | { readonly kind: "mode"; readonly value: "diagnostic"; readonly reason: string }
  | { readonly kind: "max-scene-duration"; readonly value: number; readonly reason: string }
  | { readonly kind: "cta-required"; readonly value: boolean; readonly reason: string }
  | { readonly kind: "hero-interaction-required"; readonly value: boolean; readonly reason: string }
  | { readonly kind: "arc-override"; readonly value: NarrativeArc; readonly reason: string }
  | { readonly kind: "allow-unverified-impact"; readonly value: { readonly claimId?: string }; readonly reason: string };

export type StoryCompilerInput = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly productUnderstanding: ProductUnderstanding;
  readonly dir: DemoIntermediateRepresentation;
  readonly existingDemoAnalysis?: ExistingDemoAnalysis;
  readonly browserCaptures: readonly BrowserCaptureRunInput[];
  readonly captureSelectionPolicy?: BrowserCaptureSelectionPolicy;
  readonly audience?: StoryAudience;
  readonly objective: StoryObjective;
  readonly duration: {
    readonly targetMs: number;
    readonly minimumMs: number;
    readonly maximumMs: number;
  };
  readonly constraints: readonly StoryConstraint[];
};
