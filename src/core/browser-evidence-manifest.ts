import type { DemoObservation } from "./demo-observation.js";
import type { BrowserAssertionResult } from "./browser-assertion.js";

export type BrowserEvidenceArtifactKind = "screenshot" | "dom-snapshot" | "assertion" | "url";

export type BrowserEvidenceArtifactReference = {
  readonly id: string;
  readonly kind: BrowserEvidenceArtifactKind;
  readonly artifactId: string;
  readonly verified: boolean;
};

export type BrowserEvidenceCoverage = {
  readonly requirementCount: number;
  readonly satisfiedCount: number;
  readonly criticalRequirementCount: number;
  readonly satisfiedCriticalCount: number;
  readonly verifiedArtifactCount: number;
  readonly coverageRatio: number;
  readonly sufficient: boolean;
};

export type BrowserEvidenceRequirementResult = {
  readonly requirementId: string;
  readonly claim: string;
  readonly satisfied: boolean;
  readonly importance: "supporting" | "important" | "critical";
  readonly reason: string;
};

export type BrowserEvidenceManifest = {
  readonly schemaVersion: "0.1";
  readonly capturePlanId: string;
  readonly targetId: string;
  readonly runId: string;
  readonly artifacts: readonly BrowserEvidenceArtifactReference[];
  readonly assertions: readonly BrowserAssertionResult[];
  readonly observations: readonly DemoObservation[];
  readonly coverage: BrowserEvidenceCoverage;
  /** Only requirements that are NOT satisfied — never silently dropped. */
  readonly unresolvedRequirements: readonly BrowserEvidenceRequirementResult[];
};
