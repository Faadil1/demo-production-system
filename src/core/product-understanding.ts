import type { EvidenceReference } from "./dir.js";
import type { SourceType, VerificationStatus } from "./provenance.js";

export type Fact = {
  readonly id: string;
  readonly statement: string;
  readonly source: string;
  readonly sourceType: SourceType;
  readonly confidence: number;
  readonly verificationStatus: VerificationStatus;
};

export type Claim = {
  readonly id: string;
  readonly statement: string;
  readonly source: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
};

export type Hypothesis = {
  readonly id: string;
  readonly statement: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly validationRequired: boolean;
};

export type EvidenceItem = {
  readonly id: string;
  readonly kind: EvidenceReference["kind"];
  readonly claim: string;
  readonly source: string;
  readonly importance: "supporting" | "important" | "critical";
  readonly verificationStatus: VerificationStatus;
  readonly supportsClaimIds: readonly string[];
};

export type MissingEvidence = {
  readonly id: string;
  readonly requiredClaim: string;
  readonly reason: string;
  readonly importance: "supporting" | "important" | "critical";
  readonly suggestedAcquisitionMethod: string;
};

export type HeroInteractionCandidate = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly valueDemonstrated: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  readonly risks: readonly string[];
  readonly source: SourceType;
};

export type HeroInteractionAuthority = "manifest-policy" | "human";

export type SelectedHeroInteraction = {
  readonly candidateId: string;
  readonly reason: string;
  readonly confidence: number;
  readonly authority: HeroInteractionAuthority;
  readonly requiresHumanApproval: boolean;
};

export type AmbiguitySeverity = "low" | "medium" | "high" | "critical";

export type Ambiguity = {
  readonly id: string;
  readonly question: string;
  readonly impact: string;
  readonly severity: AmbiguitySeverity;
  readonly resolutionRequired: boolean;
};

export type Risk = {
  readonly id: string;
  readonly description: string;
  readonly category: string;
  readonly severity: AmbiguitySeverity;
  readonly mitigation: string;
};

export type ConfidenceSummary = {
  readonly overall: number;
  readonly productUnderstanding: number;
  readonly evidenceCoverage: number;
  readonly heroInteractionSelection: number;
};

export type ApprovalStatus = "pending" | "satisfied" | "waived";

export type ApprovalRequirement = {
  readonly id: string;
  readonly gate: string;
  readonly reason: string;
  readonly blocking: boolean;
  readonly status: ApprovalStatus;
};

export type EvidenceCoverage = {
  readonly requiredCount: number;
  readonly availableCount: number;
  readonly verifiedCount: number;
  readonly criticalCount: number;
  readonly coverageRatio: number;
  readonly sufficient: boolean;
};

export type UnderstandingGateStatus = "pass" | "conditional" | "fail";

export type UnderstandingGate = {
  readonly name: "understanding";
  readonly status: UnderstandingGateStatus;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly requirementsBeforeRender: readonly string[];
};

export type ProductUnderstanding = {
  readonly schemaVersion: "0.2";
  readonly product: {
    readonly name: string;
    readonly problem: string;
    readonly valueProposition: string;
    readonly targetAudiences: readonly string[];
  };
  readonly facts: readonly Fact[];
  readonly claims: readonly Claim[];
  readonly hypotheses: readonly Hypothesis[];
  readonly evidence: readonly EvidenceItem[];
  readonly missingEvidence: readonly MissingEvidence[];
  readonly heroInteractionCandidates: readonly HeroInteractionCandidate[];
  readonly selectedHeroInteraction: SelectedHeroInteraction | null;
  readonly ambiguities: readonly Ambiguity[];
  readonly risks: readonly Risk[];
  readonly confidence: ConfidenceSummary;
  readonly approvalRequirements: readonly ApprovalRequirement[];
  readonly evidenceCoverage: EvidenceCoverage;
  readonly gate: UnderstandingGate;
};
