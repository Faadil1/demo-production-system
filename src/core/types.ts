export type ISODateTime = string;
export type ArtifactId = string;
export type DecisionId = string;
export type RunId = string;

export type ValidationIssue = {
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export type VerificationResult =
  | { readonly ok: true; readonly score?: number }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export type EngineMetrics = {
  readonly startedAt?: ISODateTime;
  readonly completedAt?: ISODateTime;
  readonly durationMs?: number;
  readonly inputArtifacts: number;
  readonly outputArtifacts: number;
  readonly warnings: number;
};
