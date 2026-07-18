import { readdir, readFile, realpath as fsRealpath } from "node:fs/promises";
import path from "node:path";
import type { ArtifactEnvelope } from "../core/artifact.js";
import type {
  ArtifactReference,
  ArtifactResolution,
  ArtifactResolutionFailure,
  ArtifactResolutionRequest,
  ArtifactResolutionResult,
} from "../core/artifact-resolution.js";
import { contentHashOf } from "../core/hash.js";

// Supported schema version (RFC-0007 §2)
const SUPPORTED_SCHEMA_VERSION = "0.1";

// Load result type (finding 3: distinguish error types)
type LoadResult<T> =
  | { type: "success"; artifact: ArtifactEnvelope<T> }
  | { type: "not-found" }
  | { type: "malformed-json" }
  | { type: "malformed-envelope" }
  | { type: "inaccessible" }
  | { type: "unsupported-schema"; schemaVersion: string };

// Candidate for resolution (used internally for ambiguity detection)
type ResolutionCandidate = {
  filePath: string;
  artifact: ArtifactEnvelope<unknown>;
  sourceRunId?: string;
};

// Validate artifact ID (finding 4: path safety)
function isValidArtifactId(artifactId: string): boolean {
  // Reject absolute paths
  if (path.isAbsolute(artifactId)) {
    return false;
  }

  // Reject artifact IDs containing path separators (force flat structure)
  if (artifactId.includes("/") || artifactId.includes("\\")) {
    return false;
  }

  // Reject traversal components
  if (artifactId.includes("..") || artifactId.startsWith(".")) {
    return false;
  }

  // Non-empty and contains only reasonable characters
  return artifactId.length > 0 && /^[a-zA-Z0-9._-]+$/.test(artifactId);
}

// Validate that a path stays within a base directory (finding 4: path safety)
// Uses lexical checks only; does not dereference symlinks.
function isPathSafe(basePath: string, attemptedPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedAttempted = path.resolve(basePath, attemptedPath);

  // Must be inside or equal to base
  return (
    resolvedAttempted.startsWith(resolvedBase + path.sep) || resolvedAttempted === resolvedBase
  );
}

// Validate that a real filesystem path stays within a base directory (BLOCKER: symlink containment)
// Dereferences symlinks to detect escape attempts.
// Returns { safe: true } if the real path is contained within the real base.
// Returns { safe: false; reason: string } if the path escapes, is inaccessible, or realpath fails.
async function isRealPathSafe(realBasePath: string, candidatePath: string): Promise<{ safe: boolean; reason?: string }> {
  try {
    // Resolve the real path of the candidate (dereferences symlinks and resolves . and ..)
    const realPath = await fsRealpath(candidatePath);

    // Verify real base path is also resolved
    const realBase = await fsRealpath(realBasePath);

    // Check containment: real path must be inside or equal to real base
    if (realPath === realBase) {
      return { safe: true };
    }

    if (realPath.startsWith(realBase + path.sep)) {
      return { safe: true };
    }

    // Path escapes the base directory (e.g., symlink to /etc/passwd)
    return { safe: false, reason: "Path escape detected: real path outside registry root" };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;

    // ENOENT is normal when probing optional file extensions (.json then .yaml)
    // Return safe: true to allow normal "not found" flow in loader
    if (nodeErr.code === "ENOENT") {
      return { safe: true };
    }

    // Other errors (ELOOP for symlink loops, EACCES for permission denied, etc.)
    // indicate the file exists but cannot be safely accessed or resolved
    return { safe: false, reason: `Realpath failed: ${nodeErr.code || nodeErr.message}` };
  }
}

// Load and parse an artifact JSON file (finding 3: distinguish error types)
// Accepts optional readFileFn for testing inaccessible file scenarios (finding 2 coverage)
async function loadArtifactFile<T>(
  filePath: string,
  readFileFn?: ((path: string, encoding: string) => Promise<string>) | typeof readFile
): Promise<LoadResult<T>> {
  const reader = readFileFn || readFile;
  try {
    const raw = await reader(filePath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return { type: "malformed-json" };
    }

    // Validate envelope structure (finding 3)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.artifactId !== "string" ||
      typeof parsed.schemaVersion !== "string" ||
      !parsed.payload
    ) {
      return { type: "malformed-envelope" };
    }

    // Check schema version (finding 2)
    if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return { type: "unsupported-schema", schemaVersion: parsed.schemaVersion };
    }

    return { type: "success", artifact: parsed as ArtifactEnvelope<T> };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { type: "not-found" };
    }
    // Permission denied, file descriptor error, etc.
    return { type: "inaccessible" };
  }
}

// Get list of run directories in parent, sorted reverse-chronological then lexical
async function listSiblingRuns(registryRootPath: string): Promise<string[]> {
  const parentDir = path.dirname(registryRootPath);

  // Validate sibling directory path safety (finding 4)
  if (!isPathSafe(parentDir, parentDir)) {
    return [];
  }

  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse(); // reverse-chronological (newest first) assuming run-id is timestamp-like

    return dirs;
  } catch {
    return [];
  }
}

// Validate that an artifact matches a reference (returns only validity, not failure)
function validateArtifactMatch(
  reference: ArtifactReference,
  artifact: ArtifactEnvelope<unknown>
): { type: "valid" } | { type: "invalid"; reason: string } {
  // Check artifact kind matches
  if (artifact.artifactType !== reference.kind) {
    return { type: "invalid", reason: "ARTIFACT_KIND_MISMATCH" };
  }

  // Verify content hash (finding 6: authoritative check)
  const computedHash = contentHashOf(artifact.payload);
  if (computedHash !== reference.expectedContentHash) {
    return { type: "invalid", reason: "ARTIFACT_HASH_MISMATCH" };
  }

  // Also check stored contentHash matches computed (finding 6: validate authority)
  if (artifact.contentHash !== computedHash) {
    return { type: "invalid", reason: "ARTIFACT_CORRUPTED" };
  }

  return { type: "valid" };
}

// Map a LoadResult to an ArtifactResolutionFailure (finding 3: error mapping)
function loadResultToFailure(reference: ArtifactReference, result: LoadResult<unknown>): ArtifactResolutionFailure {
  switch (result.type) {
    case "success":
      throw new Error("Unexpected success result in loadResultToFailure");
    case "not-found":
      return {
        requestedReference: reference,
        reason: "ARTIFACT_NOT_FOUND",
        details: "File does not exist",
        resolution: "required-reference-failed",
      };
    case "malformed-json":
      return {
        requestedReference: reference,
        reason: "ARTIFACT_CORRUPTED",
        details: "Artifact file contains invalid JSON",
        resolution: "required-reference-failed",
      };
    case "malformed-envelope":
      return {
        requestedReference: reference,
        reason: "ARTIFACT_CORRUPTED",
        details: "Artifact envelope is malformed or missing required fields",
        resolution: "required-reference-failed",
      };
    case "inaccessible":
      return {
        requestedReference: reference,
        reason: "REGISTRY_INACCESSIBLE",
        details: "Unable to read artifact file (permission denied or I/O error)",
        resolution: "required-reference-failed",
      };
    case "unsupported-schema":
      return {
        requestedReference: reference,
        reason: "ARTIFACT_SCHEMA_UNSUPPORTED",
        details: `Artifact schema version '${result.schemaVersion}' is not supported (expected '${SUPPORTED_SCHEMA_VERSION}')`,
        resolution: "required-reference-failed",
      };
  }
}

// Find all valid candidates within a single run directory
// (BLOCKER: symlink escape safety — validates real paths stay within registry root)
async function findValidCandidatesInRun(
  runPath: string,
  reference: ArtifactReference,
  readFileFn?: (path: string, encoding: string) => Promise<string>
): Promise<ResolutionCandidate[]> {
  const candidates: ResolutionCandidate[] = [];

  // Try both .json and .yaml extensions
  const jsonPath = path.join(runPath, `${reference.artifactId}.json`);
  const yamlPath = path.join(runPath, `${reference.artifactId}.yaml`);

  // Validate paths stay within registry root (finding 4: lexical check)
  if (!isPathSafe(runPath, jsonPath)) {
    return [];
  }

  // Validate real path (dereference symlinks) stays within registry root (BLOCKER: symlink safety)
  const jsonRealSafe = await isRealPathSafe(runPath, jsonPath);
  if (!jsonRealSafe.safe) {
    // Real path escaped the root; reject this candidate
    return [];
  }

  // Try JSON first
  const jsonResult = await loadArtifactFile<unknown>(jsonPath, readFileFn);
  if (jsonResult.type === "success") {
    const match = validateArtifactMatch(reference, jsonResult.artifact);
    if (match.type === "valid") {
      candidates.push({ filePath: jsonPath, artifact: jsonResult.artifact });
    }
  }

  // Try YAML (for now we only support JSON, so this will fail)
  if (!isPathSafe(runPath, yamlPath)) {
    return candidates;
  }

  // Validate real path for YAML file
  const yamlRealSafe = await isRealPathSafe(runPath, yamlPath);
  if (!yamlRealSafe.safe) {
    // Real path escaped; stop here
    return candidates;
  }

  const yamlResult = await loadArtifactFile<unknown>(yamlPath, readFileFn);
  if (yamlResult.type === "success") {
    const match = validateArtifactMatch(reference, yamlResult.artifact);
    if (match.type === "valid") {
      candidates.push({ filePath: yamlPath, artifact: yamlResult.artifact });
    }
  }

  return candidates;
}

// Find all valid candidates in sibling runs (reverse chronological order)
async function findValidCandidatesInSiblings(
  registryRootPath: string,
  reference: ArtifactReference,
  readFileFn?: (path: string, encoding: string) => Promise<string>
): Promise<ResolutionCandidate[]> {
  const candidates: ResolutionCandidate[] = [];
  const siblings = await listSiblingRuns(registryRootPath);

  for (const sibling of siblings) {
    const siblingPath = path.join(path.dirname(registryRootPath), sibling);

    // Skip the original run directory
    if (siblingPath === registryRootPath) {
      continue;
    }

    const siblingCandidates = await findValidCandidatesInRun(siblingPath, reference, readFileFn);

    // Add source run ID to track cross-run resolution
    for (const candidate of siblingCandidates) {
      candidates.push({
        ...candidate,
        sourceRunId: sibling,
      });
    }

    // Stop after first sibling with valid candidates (deterministic ordering)
    if (candidates.length > 0) {
      break;
    }
  }

  return candidates;
}

// Collect all valid candidates for an artifact reference (finding 1: ambiguity handling)
async function collectCandidates(
  request: ArtifactResolutionRequest,
  reference: ArtifactReference,
  readFileFn?: (path: string, encoding: string) => Promise<string>
): Promise<ResolutionCandidate[]> {
  const candidates: ResolutionCandidate[] = [];

  // Same-run candidates (preferred)
  const sameRunCandidates = await findValidCandidatesInRun(request.registryRootPath, reference, readFileFn);
  candidates.push(...sameRunCandidates);

  // If same-run has valid candidates, prefer those and don't search siblings
  // (RFC-0007 §8.6 specifies same-run is checked first)
  if (candidates.length > 0) {
    return candidates;
  }

  // Only search siblings if same-run had no valid candidates and cross-run is enabled
  if (request.allowCrossRunReferences) {
    const siblingCandidates = await findValidCandidatesInSiblings(request.registryRootPath, reference, readFileFn);
    candidates.push(...siblingCandidates);
  }

  return candidates;
}

// Determine the specific reason a resolution failed
async function determineResolutionFailure(
  registryRootPath: string,
  reference: ArtifactReference,
  readFileFn?: (path: string, encoding: string) => Promise<string>
): Promise<ArtifactResolutionFailure> {
  // Try to load the artifact to determine the exact failure reason
  const jsonPath = path.join(registryRootPath, `${reference.artifactId}.json`);
  const yamlPath = path.join(registryRootPath, `${reference.artifactId}.yaml`);

  // Try JSON
  if (isPathSafe(registryRootPath, jsonPath)) {
    const result = await loadArtifactFile<unknown>(jsonPath, readFileFn);
    if (result.type === "success") {
      // Check if validation fails (e.g., forged hash)
      const validation = validateArtifactMatch(reference, result.artifact);
      if (validation.type === "invalid") {
        return {
          requestedReference: reference,
          reason: validation.reason as any,
          details: `Validation failed for artifact: ${validation.reason}`,
          resolution: "required-reference-failed",
        };
      }
    } else if (result.type !== "not-found") {
      return loadResultToFailure(reference, result);
    }
  }

  // Try YAML
  if (isPathSafe(registryRootPath, yamlPath)) {
    const result = await loadArtifactFile<unknown>(yamlPath, readFileFn);
    if (result.type === "success") {
      // Check if validation fails
      const validation = validateArtifactMatch(reference, result.artifact);
      if (validation.type === "invalid") {
        return {
          requestedReference: reference,
          reason: validation.reason as any,
          details: `Validation failed for artifact: ${validation.reason}`,
          resolution: "required-reference-failed",
        };
      }
    } else if (result.type !== "not-found") {
      return loadResultToFailure(reference, result);
    }
  }

  // Both files not found
  return {
    requestedReference: reference,
    reason: "ARTIFACT_NOT_FOUND",
    details: `No artifact found at ${jsonPath} or ${yamlPath}`,
    resolution: "required-reference-failed",
  };
}

/**
 * Resolve artifact references against a filesystem registry.
 * Implements RFC-0007 §8 resolution semantics:
 * - deterministic lookup by artifactId + expectedContentHash
 * - fail-closed on hash mismatch, missing artifacts, schema mismatch
 * - no silent ambiguity; emit ARTIFACT_AMBIGUOUS_MATCH when multiple valid candidates exist
 * - optional sibling-run resolution when allowCrossRunReferences is true
 * - deterministic ordering and candidate selection
 * - BLOCKER: symlink containment checks using realpath (not lexical checks alone)
 *
 * Note: resolvedAt is intentionally excluded for determinism (RFC-0007 §11.3).
 *
 * @param request — The resolution request
 * @param readFileFn — Optional injectable readFile function (for testing inaccessible files)
 */
export async function resolveArtifacts(
  request: ArtifactResolutionRequest,
  readFileFn?: (path: string, encoding: string) => Promise<string>
): Promise<ArtifactResolutionResult> {
  const resolutions: ArtifactResolution[] = [];
  const failures: ArtifactResolutionFailure[] = [];
  let gateStatus: "pass" | "fail" = "pass";

  // Validate registry root path safety (finding 4: lexical check)
  if (!isPathSafe(request.registryRootPath, request.registryRootPath)) {
    return {
      schemaVersion: "0.1",
      resolutions: [],
      failures: request.artifactReferences.map((ref) => ({
        requestedReference: ref,
        reason: "ARTIFACT_UNSAFE_PATH" as const,
        details: "Registry root path is invalid",
        resolution: "required-reference-failed" as const,
      })),
      gate: {
        status: "fail",
        reason: "Registry root path is unsafe",
      },
    };
  }

  // Validate registry root real path stays within itself (BLOCKER: symlink safety for root)
  // This is a defense-in-depth check; the registry root should never be a symlink to outside itself
  const rootRealSafe = await isRealPathSafe(request.registryRootPath, request.registryRootPath);
  if (!rootRealSafe.safe) {
    return {
      schemaVersion: "0.1",
      resolutions: [],
      failures: request.artifactReferences.map((ref) => ({
        requestedReference: ref,
        reason: "ARTIFACT_UNSAFE_PATH" as const,
        details: `Registry root path is unsafe (symlink containment failed): ${rootRealSafe.reason}`,
        resolution: "required-reference-failed" as const,
      })),
      gate: {
        status: "fail",
        reason: "Registry root path symlink containment failed",
      },
    };
  }

  // Process each requested reference (finding 1: ambiguity detection)
  for (const reference of request.artifactReferences) {
    // Validate artifact ID (finding 4: path safety)
    if (!isValidArtifactId(reference.artifactId)) {
      failures.push({
        requestedReference: reference,
        reason: "ARTIFACT_UNSAFE_PATH",
        details: `Artifact ID '${reference.artifactId}' contains invalid characters or traversal components`,
        resolution: "required-reference-failed",
      });
      gateStatus = "fail";
      continue;
    }

    // Collect all valid candidates from same-run and optionally siblings
    const candidates = await collectCandidates(request, reference, readFileFn);

    if (candidates.length === 0) {
      // No candidates found; determine the specific failure reason
      const failure = await determineResolutionFailure(request.registryRootPath, reference, readFileFn);
      failures.push(failure);
      gateStatus = "fail";
      continue;
    }

    if (candidates.length === 1) {
      // Exactly one valid candidate (finding 1: no ambiguity)
      const candidate = candidates[0]!;
      resolutions.push({
        requestedReference: reference,
        resolvedArtifactId: candidate.artifact.artifactId,
        resolvedPath: candidate.filePath,
        resolvedContentHash: contentHashOf(candidate.artifact.payload),
        sourceRunId: candidate.sourceRunId,
      });
      continue;
    }

    // Multiple valid candidates: ambiguity (finding 1)
    failures.push({
      requestedReference: reference,
      reason: "ARTIFACT_AMBIGUOUS_MATCH",
      details: `Found ${candidates.length} valid candidates for artifact '${reference.artifactId}' with expected hash '${reference.expectedContentHash}'`,
      resolution: "required-reference-failed",
    });
    gateStatus = "fail";
  }

  const gateReason: string | undefined =
    gateStatus === "fail" ? `${failures.length} artifact(s) failed to resolve` : undefined;

  return {
    schemaVersion: "0.1",
    resolutions,
    failures,
    gate: {
      status: gateStatus,
      ...(gateReason && { reason: gateReason }),
    },
  };
}
