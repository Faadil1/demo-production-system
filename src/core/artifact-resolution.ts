import type { ArtifactId, ISODateTime } from "./types.js";

// § RFC-0007 §2 — Artifact Reference
export type ArtifactReference =
  | { readonly kind: "understanding"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "dir"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "plan"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "existing-demo-analysis"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "browser-capture-result"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "storyboard"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "render-plan"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "render-gate"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "resolved-render-assets"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "render-output-profile"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "adapter-capabilities"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "render-override"; readonly artifactId: string; readonly expectedContentHash: string };

// § RFC-0007 §2 — Resolution Request
export type ArtifactResolutionRequest = {
  readonly schemaVersion: "0.1";
  readonly registryRootPath: string; // typically `.dps/runs/<run-id>`
  readonly artifactReferences: readonly ArtifactReference[];
  readonly allowCrossRunReferences?: boolean; // if true, can resolve from sibling runs
};

// § RFC-0007 §2 — Successful Resolution
// Note: resolvedAt is intentionally excluded for determinism (RFC-0007 §11.3).
// Timestamps are nondeterministic by nature and are excluded from canonical output.
export type ArtifactResolution = {
  readonly requestedReference: ArtifactReference;
  readonly resolvedArtifactId: string;
  readonly resolvedPath: string; // filesystem path to artifact JSON/YAML
  readonly resolvedContentHash: string;
  readonly sourceRunId?: string | undefined; // if cross-run reference
};

// § RFC-0007 §12.1 — Failure Reason Codes
export type ArtifactResolutionFailureReasonCode =
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_KIND_MISMATCH"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_SCHEMA_UNSUPPORTED"
  | "ARTIFACT_CORRUPTED"
  | "ARTIFACT_AMBIGUOUS_MATCH"
  | "ARTIFACT_UNSAFE_PATH"
  | "REGISTRY_INACCESSIBLE";

// § RFC-0007 §2 — Resolution Failure
export type ArtifactResolutionFailure = {
  readonly requestedReference: ArtifactReference;
  readonly reason: ArtifactResolutionFailureReasonCode;
  readonly details: string;
  readonly resolution: "required-reference-failed" | "optional-reference-failed";
};

// § RFC-0007 §2 — Resolution Result
export type ArtifactResolutionResult = {
  readonly schemaVersion: "0.1";
  readonly resolutions: readonly ArtifactResolution[];
  readonly failures: readonly ArtifactResolutionFailure[];
  readonly gate: { readonly status: "pass" | "fail"; readonly reason?: string };
};
