import type { MediaInspection } from "./media-inspection.js";
import type { MediaSource } from "./media-source.js";
import type { DemoScore } from "./demo-score.js";
import type { TranscriptSourceType } from "./transcript.js";
import type { VerificationStatus } from "./provenance.js";

export type TranscriptSummary = {
  readonly present: boolean;
  readonly segmentCount: number;
  readonly totalSpokenSeconds: number;
  readonly words: number;
  readonly wordsPerMinute: number | null;
  readonly language: string | null;
  readonly provenance: {
    readonly sourceType: TranscriptSourceType | null;
  };
};

export type DemoSectionType =
  | "opening"
  | "problem"
  | "product-introduction"
  | "workflow"
  | "hero-interaction"
  | "evidence"
  | "result"
  | "closing"
  | "call-to-action";

export type DemoStructureSection = {
  readonly type: DemoSectionType;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly confidence: number;
  readonly supportingObservationIds: readonly string[];
};

export type DemoStructureAnalysis = {
  readonly detectedSections: readonly DemoStructureSection[];
  readonly missingSections: readonly DemoSectionType[];
  readonly confidence: number;
};

export type ExistingDemoHeroStatus = "identified" | "candidate-only" | "not-found" | "ambiguous";

export type ExistingDemoHeroAnalysis = {
  readonly candidateStatement: string | null;
  readonly sourceObservationIds: readonly string[];
  readonly supportingEvidenceIds: readonly string[];
  readonly interactionStart: number | null;
  readonly interactionEnd: number | null;
  readonly visibleOutcome: string | null;
  readonly confidence: number;
  readonly status: ExistingDemoHeroStatus;
};

export type ExistingDemoEvidenceKind =
  | "proof-visible"
  | "result-visible"
  | "claim-spoken"
  | "claim-on-screen"
  | "before-after-pair";

export type ExistingDemoEvidenceItem = {
  readonly id: string;
  readonly kind: ExistingDemoEvidenceKind;
  readonly observationIds: readonly string[];
  readonly verificationStatus: VerificationStatus;
  readonly description: string;
};

export type ExistingDemoEvidenceAnalysis = {
  readonly items: readonly ExistingDemoEvidenceItem[];
  readonly verifiedVisualEvidenceCount: number;
  readonly spokenClaimCount: number;
  readonly onScreenClaimCount: number;
  readonly resultVisibleCount: number;
  readonly beforeAfterPairCount: number;
  readonly unsupportedClaimCount: number;
  readonly proofCoverageRatio: number;
};

export type PacingStatus = "fast" | "balanced" | "slow" | "unknown";

export type DemoRhythmAnalysis = {
  readonly durationSeconds: number | null;
  readonly observationDensity: number | null;
  readonly averageObservationDuration: number | null;
  readonly longestGapSeconds: number | null;
  readonly openingDuration: number | null;
  readonly proofArrivalSeconds: number | null;
  readonly closingDuration: number | null;
  readonly pacingStatus: PacingStatus;
  readonly warnings: readonly string[];
};

export type DemoClarityAnalysis = {
  readonly productVisible: boolean;
  readonly problemEstablished: boolean;
  readonly valuePropositionPresent: boolean;
  readonly heroInteractionVisible: boolean;
  readonly resultVisible: boolean;
  readonly callToActionPresent: boolean;
  readonly evidenceTraceable: boolean;
  readonly warnings: readonly string[];
};

export type ExistingDemoRiskSeverity = "low" | "medium" | "high" | "critical";

export type ExistingDemoRisk = {
  readonly id: string;
  readonly category: string;
  readonly severity: ExistingDemoRiskSeverity;
  readonly description: string;
  readonly relatedObservationIds: readonly string[];
  readonly mitigation: string;
};

export type ExistingDemoUnknown = {
  readonly id: string;
  readonly question: string;
  readonly reason: string;
  readonly impact: string;
  readonly acquisitionMethod: string;
};

export type ExistingDemoAnalysisGateStatus = "pass" | "conditional" | "fail";

export type ExistingDemoAnalysisGate = {
  readonly name: "existing-demo-analysis";
  readonly status: ExistingDemoAnalysisGateStatus;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly requirementsBeforeUse: readonly string[];
};

export type ExistingDemoAnalysis = {
  readonly schemaVersion: "0.1";
  readonly source: MediaSource;
  readonly mediaInspection: MediaInspection;
  readonly transcriptSummary: TranscriptSummary;
  readonly structure: DemoStructureAnalysis;
  readonly heroInteraction: ExistingDemoHeroAnalysis;
  readonly evidenceAnalysis: ExistingDemoEvidenceAnalysis;
  readonly rhythmAnalysis: DemoRhythmAnalysis;
  readonly clarityAnalysis: DemoClarityAnalysis;
  readonly risks: readonly ExistingDemoRisk[];
  readonly unknowns: readonly ExistingDemoUnknown[];
  readonly score: DemoScore;
  readonly gate: ExistingDemoAnalysisGate;
};
