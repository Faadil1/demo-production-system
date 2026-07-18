# RFC-0007 â€” Artifact Resolution and Pipeline Orchestration v0.1

Status: **Specification for implementation**
Depends on: RFC-0001 through RFC-0006
Primary input: Registered artifacts in `.dps/runs/<run-id>/`, deterministic CLI input
Primary output: Chained stage outputs without manual payload assembly

---

## 1. Status and Executive Summary

RFC-0001 through RFC-0006 have built individual stages of the demo-production pipeline. Each stage produces deterministic, immutable artifacts; each is independently testable and contractually sound.

However, the stages are not automatically chained. A user who wants to run:
1. `npm run demo` â†’ `compile-story` â†’ `compile-render`

...currently must manually assemble the outputs of stage N as the inputs of stage N+1, by copying JSON/YAML payloads into new input bundles. This breaks reproducibility and prevents practical orchestration.

RFC-0007 introduces:

1. **Artifact Resolution:** CLI commands can reference upstream artifacts by ID + content-hash (already in contracts as "artifact references") instead of requiring full payloads inline.
2. **Registry Resolution:** A deterministic lookup service resolves artifact IDs against the filesystem registry in `.dps/runs/<run-id>/`.
3. **Pipeline Orchestration:** A single coordinated entry point invokes stages in order, automatically routing outputs to inputs.
4. **Immutability and Provenance:** Resolved artifacts are read-only; full lineage is preserved in decision logs and artifact metadata.

RFC-0007 does **not** render frames, export MP4, or introduce any renderer-specific logic. It is purely about making the existing pipeline stages usable end-to-end.

---

## 2. Problem Statement

### The Gap

Individual stages of the DPS pipeline are production-ready:

| Stage | Input | Output | CLI |
|---|---|---|---|
| Understanding | `demo.yaml` (manifest) | `ProductUnderstanding`, `DemoIntermediateRepresentation`, decision log | `npm run demo` |
| Story | `story-input.yaml` (StoryCompilerInput) | `Storyboard`, decision log | `npm run compile-story` |
| Render | `render-input.yaml` (RenderCompilerBundle) | `RenderPlan`, `RenderGate`, decision log | `npm run compile-render` |

### The Problem

- RFC-0005 implementation doc: "CLI accepts a single document with upstream artifact payloads inlined, rather than artifact-id references resolved against a filesystem registry."
- RFC-0006 Known Limitation #6: "`RenderCompilerInput`'s artifact-id references are not resolved against the filesystem registry by the CLI; the caller supplies the referenced payloads inline in the bundle file... Registry-based resolution is future CLI work."

**Current workflow:**

```
1. User runs: npm run demo -- demo.yaml
   Output: .dps/runs/run-<id>/understanding.json, plan.json, dir.json, ...

2. User manually creates story-input.yaml with:
   - productUnderstanding: <copy JSON from stage 1>
   - dir: <copy JSON from stage 1>

3. User runs: npm run compile-story -- story-input.yaml
   Output: .dps/runs/run-<id>/storyboard.json

4. User manually creates render-input.yaml with:
   - storyboard: <copy JSON from stage 2>
   - adapterCapabilities: <manually supplied>
   - assets: <manually supplied>
   - bindings: <manually supplied>

5. User runs: npm run compile-render -- render-input.yaml
   Output: .dps/runs/run-<id>/render-plan.json, render-gate.json
```

This defeats reproducibility. The same input should produce byte-identical outputs on repeated runs, but manual bundle assembly is error-prone and opaque to versioning.

### Why This Matters

Mission Principle V: "A demonstration must be rebuildable from its versioned configuration, artifacts, decisions, assets, and adapter versions."

Without automatic chaining and artifact resolution, users cannot easily rebuild from saved configuration; they must manually reconstruct intermediate bundles.

---

## 3. Goals

RFC-0007 MUST provide:

1. **Artifact Resolution Semantics** â€” Typed, deterministic rules for resolving artifact IDs to registered payloads
2. **Registry Query Interface** â€” Read-only artifact lookup from `.dps/runs/<run-id>/` by artifactId + expectedContentHash
3. **Lineage Preservation** â€” Full provenance chain recorded in decision logs; no artifact is ever mutated
4. **Pipeline Orchestration** â€” Single coordinated entry point that chains stages without user intervention
5. **Deterministic Stage Ordering** â€” Canonical order, failure modes, and artifact binding order
6. **Fail-Closed Semantics** â€” Missing, stale, ambiguous, or hash-mismatched artifacts explicitly reject; no silent fallbacks
7. **Cross-Run References** â€” Optional ability to reference artifacts from prior runs (same registry)
8. **Worked End-to-End Example** â€” One complete demo from input through Storyboard + RenderPlan
9. **CLI Orchestration Command** â€” User-facing interface for chained execution
10. **Determinism Guarantees** â€” Same input run twice produces byte-identical RenderPlan (modulo timestamps excluded per prior RFCs)
11. **Immutability Enforcement** â€” Upstream artifacts remain read-only; no mutation by downstream stages
12. **Decision Log Integration** â€” Each orchestration decision (artifact resolution, stage execution, lineage binding) is recorded
13. **Typed Contracts** â€” Close artifact-reference and orchestration types; no stringly-typed lookups

---

## 4. Non-Goals

RFC-0007 MUST NOT:

- Introduce a Remotion renderer adapter or any renderer-specific logic
- Render frames or export MP4
- Implement post-render validation
- Modify the contracts of RFC-0001â€“0006 (only add orchestration and resolution on top)
- Implement asynchronous execution, parallel stages, or caching beyond the filesystem registry
- Add network-based or cloud artifact resolution (filesystem-only in v0.1)
- Implement implicit semantic inference (e.g., auto-derive bindings from Storyboard presentation intent)
- Mutate existing immutable artifacts
- Change story mode, arc, claims, proof chains, evidence, or narrative structure mid-pipeline

---

## 5. Contracts

### Â§1 Artifact Reference

An artifact reference is a typed, immutable pointer to a registered artifact.

```typescript
export type ArtifactReference =
  | { readonly kind: "understanding"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "dir"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "existing-demo-analysis"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "browser-capture-result"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "storyboard"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "render-output-profile"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "adapter-capabilities"; readonly artifactId: string; readonly expectedContentHash: string }
  | { readonly kind: "render-override"; readonly artifactId: string; readonly expectedContentHash: string };

export type ArtifactResolutionRequest = {
  readonly schemaVersion: "0.1";
  readonly registryRootPath: string; // typically `.dps/runs/<run-id>`
  readonly artifactReferences: readonly ArtifactReference[];
  readonly allowCrossRunReferences?: boolean; // if true, can resolve from sibling runs
};

export type ArtifactResolutionResult = {
  readonly schemaVersion: "0.1";
  readonly resolutions: readonly ArtifactResolution[];
  readonly failures: readonly ArtifactResolutionFailure[];
  readonly gate: { readonly status: "pass" | "fail"; readonly reason?: string };
};

export type ArtifactResolution = {
  readonly requestedReference: ArtifactReference;
  readonly resolvedArtifactId: string;
  readonly resolvedPath: string; // filesystem path to artifact JSON/YAML
  readonly resolvedContentHash: string;
  readonly resolvedAt: ISODateTime;
  readonly sourceRunId?: string; // if cross-run reference
};

export type ArtifactResolutionFailureReasonCode =
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_KIND_MISMATCH"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_SCHEMA_UNSUPPORTED"
  | "ARTIFACT_CORRUPTED"
  | "ARTIFACT_AMBIGUOUS_MATCH"
  | "ARTIFACT_UNSAFE_PATH"
  | "REGISTRY_INACCESSIBLE";

export type ArtifactResolutionFailure = {
  readonly requestedReference: ArtifactReference;
  readonly reason: ArtifactResolutionFailureReasonCode;
  readonly details: string;
  readonly resolution: "required-reference-failed" | "optional-reference-failed";
};
```

---

### Â§2 Pipeline Orchestration Input and Result

```typescript
export type PipelineOrchestrationInput = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly manifestPath: string; // path to demo.yaml or similar
  readonly targetStages: ("demo" | "story" | "render")[]; // which stages to run
  readonly storyConstraints?: readonly StoryConstraint[];
  readonly renderConstraints?: {
    readonly outputProfile?: RenderOutputProfileReference;
    readonly entryRequirementClassifications?: readonly EntryRequirementClassification[];
  };
  readonly storyInputOverride?: {
    readonly audience?: StoryAudience;
    readonly objective?: StoryObjective;
    readonly duration?: { readonly targetMs: number; readonly minimumMs: number; readonly maximumMs: number };
  };
  readonly renderInputOverride?: {
    readonly assetBindingRequests?: readonly RenderBindingRequest[];
    readonly textLayerRequests?: readonly RenderTextLayerRequest[];
    readonly assetCandidates?: readonly RenderAssetCandidateRecord[];
  };
  readonly allowCrossRunArtifactReferences?: boolean;
};

export type PipelineStageExecution = {
  readonly stage: "demo" | "story" | "render";
  readonly status: "pass" | "conditional" | "fail";
  readonly gate?: { readonly status: "pass" | "conditional" | "fail"; readonly blockingReasons?: readonly string[] };
  readonly inputArtifacts: readonly ArtifactResolution[];
  readonly outputArtifactIds: readonly string[];
  readonly executedAt: ISODateTime;
  readonly durationMs: number;
  readonly reason?: string;
};

export type PipelineOrchestrationResult = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly runId: string;
  readonly orchestrationInput: PipelineOrchestrationInput;
  readonly orchestrationGate: OrchestrationGate;
  readonly stageExecutions: readonly PipelineStageExecution[];
  readonly finalArtifactIds: readonly string[];
  readonly lineageEdges: readonly LineageEdge[];
  readonly completedAt: ISODateTime;
};

export type OrchestrationGate = {
  readonly status: "pass" | "conditional" | "fail";
  readonly reasons: readonly OrchestrationGateReasonCode[];
  readonly upstreamGates?: {
    readonly understanding?: { readonly status: "pass" | "conditional" | "fail" };
    readonly story?: { readonly status: "pass" | "conditional" | "fail" };
    readonly render?: { readonly status: "pass" | "conditional" | "fail" };
  };
};

export type OrchestrationGateReasonCode =
  | "MANIFEST_INVALID"
  | "MANIFEST_NOT_FOUND"
  | "STAGE_ARTIFACT_MISSING"
  | "STAGE_ARTIFACT_HASH_MISMATCH"
  | "STAGE_GATE_FAILED"
  | "STAGE_GATE_CONDITIONAL"
  | "ARTIFACT_RESOLUTION_FAILED"
  | "LINEAGE_AMBIGUOUS"
  | "OUTPUT_REGISTRATION_FAILED"
  | "ORCHESTRATION_INTERRUPTED";

export type LineageEdge = {
  readonly source: { readonly runId: string; readonly artifactId: string };
  readonly target: { readonly runId: string; readonly artifactId: string };
  readonly edge: "understanding-to-story" | "story-to-render" | "demo-to-story" | "demo-to-render";
  readonly resolvedAt: ISODateTime;
};
```

---

## 6. Resolution Semantics (Â§8 Normative)

### Â§8.1 Artifact ID Lookup

An artifact ID is a unique identifier within a run. The registry lookup follows this algorithm:

```
Given:
  registryRootPath (e.g., `.dps/runs/run-123`)
  artifactId (e.g., `storyboard`)

Lookup:
  1. Check <registryRootPath>/<artifactId>.json
  2. Check <registryRootPath>/<artifactId>.yaml
  3. If allowCrossRunReferences and not found:
     a. Enumerate sibling runs in `.dps/runs/`
     b. For each run in reverse chronological order:
        - Check <sibling>/<artifactId>.json
        - Check <sibling>/<artifactId>.yaml
     c. Use first match (most recent run)
  4. If still not found: emit ARTIFACT_NOT_FOUND
```

**Deterministic Ordering:** Cross-run lookups must use reverse chronological order (newest first) and break ties by run-id lexical ordering. This ensures repeated execution selects the same artifact.

### Â§8.2 Content-Hash Verification

Every ArtifactReference includes expectedContentHash. After lookup:

```
1. Read artifact payload from disk
2. Compute contentHash = sha256(canonicalStringify(payload))
3. If contentHash != expectedContentHash:
   - Emit ARTIFACT_HASH_MISMATCH
   - Fail the reference (fail-closed)
4. If contentHash matches:
   - Reference is valid; proceed to schema validation
```

This guarantees artifact integrity; stale or modified artifacts are rejected.

### Â§8.3 Schema and Kind Validation

Every artifact has a declared schema version and kind. After hash verification:

```
1. Load artifact type from payload.schemaVersion
2. Verify artifact.kind matches ArtifactReference.kind
3. If mismatch: emit ARTIFACT_KIND_MISMATCH; fail
4. If schema version not supported: emit ARTIFACT_SCHEMA_UNSUPPORTED; fail
5. Validate artifact shape against JSON Schema in schemas/<kind>.schema.json
6. If invalid: emit ARTIFACT_CORRUPTED; fail
```

### Â§8.4 Duplicate and Ambiguous References

Within a single orchestration run, two artifact references to different artifactIds with identical expectedContentHash is allowed only if they are not in a mutual consumer relationship (i.e., not in the same lineage edge chain). Duplicates in the same consumer chain are ambiguous.

```
If detectDuplicate(reference1, reference2) where both are in same stage input:
  - Emit ARTIFACT_AMBIGUOUS_MATCH
  - Fail the stage (fail-closed)
```

### Â§8.5 Missing vs. Optional Artifacts

Some artifact references are required (blocking); others are optional (non-blocking).

```
If required-reference fails:
  - Stage execution fails; orchestration gate fails
If optional-reference fails:
  - Stage execution is conditional (reports failure but continues)
  - Downstream stages may or may not proceed (depending on their requirements)
```

Current v0.1 artifact requirements (from RFC contracts):

| Reference | Requirement |
|---|---|
| ProductUnderstanding (for story) | Required |
| DemoIntermediateRepresentation (for story) | Required |
| ExistingDemoAnalysis (for story) | Optional |
| BrowserCaptureResult[] (for story) | Required (array may be empty) |
| Storyboard (for render) | Required |
| AdapterCapabilities (for render) | Required |
| RenderOutputProfile (for render) | Optional (inline custom allowed) |
| RenderOverrideRecord[] (for render) | Optional |

### Â§8.6 Cross-Run References

By default, artifact resolution stays within a single run. If `allowCrossRunReferences: true`:

```
1. Search within requestedRunId first
2. If not found and allowCrossRunReferences, search sibling runs (most recent first)
3. If found in sibling run:
   - Include sourceRunId in ArtifactResolution
   - Record lineage edge with source run ID
   - Proceed normally (hash check, validation, etc.)
4. Include full lineage in final PipelineOrchestrationResult
```

---

## 7. Stage Graph and Lineage (Â§9 Normative)

### Â§9.1 Canonical Stage Ordering

The demo-production pipeline has one canonical ordering:

```
1. demo: demo.yaml â†’ [UnderstandingEngine, PlanningEngine, DIRCompiler]
         â†’ ProductUnderstanding, DemoIntermediateRepresentation, Plan, Decision Log

2. story: [Resolve: ProductUnderstanding, DIR, ExistingDemoAnalysis?, BrowserCaptures?]
          â†’ [StoryEngine]
          â†’ Storyboard, StoryGate, Decision Log

3. render: [Resolve: Storyboard, AdapterCapabilities, assetCandidates, bindings, profiles]
           â†’ [RenderEngine]
           â†’ RenderPlan, RenderGate, ResolvedRenderAssets, Decision Log
```

Stages must be executed in this order. Out-of-order execution is rejected.

### Â§9.2 Lineage Edges

Every artifact in the final orchestration result carries lineage metadata recording which upstream artifacts it depends on:

```
LineageEdge:
  demo â†’ ProductUnderstanding, DemoIntermediateRepresentation, Plan
  demo â†’ story (if story is requested stage)
  story â†’ Storyboard
  story â†’ render (if render is requested stage)
  render â†’ RenderPlan, RenderGate
```

Lineage is recorded in decision logs for full auditability.

### Â§9.3 Artifact Binding Rules

When stage N consumes stage N-1's outputs, the binding must be:

1. **Explicit** â€” artifact references name exactlywhich upstream artifacts they bind to
2. **Deterministic** â€” same binding order across repeated runs (array ordering is determined by artifact ID lexical sort)
3. **Immutable** â€” upstream artifact is never re-produced or modified; only read

---

## 8. Orchestration Semantics (Â§10 Normative)

### Â§10.1 In-Process Execution (Recommended for v0.1)

RFC-0007 v0.1 specifies in-process orchestration:

```
Orchestration CLI
  â†’ Loads PipelineOrchestrationInput (YAML/JSON)
  â†’ Instantiates FilesystemArtifactRegistry
  â†’ For each requested stage in order:
       1. Resolve artifact references via ArtifactResolution
       2. Invoke engine in-process (UnderstandingEngine, StoryEngine, RenderEngine)
       3. Register output artifacts
       4. Record lineage edges and decision log
       5. Check gate status; fail-closed if blocking gate fails
       6. Proceed to next stage or abort
  â†’ Write PipelineOrchestrationResult to registry
  â†’ Return exit code based on OrchestrationGate.status
```

**Why:** Keeps orchestration deterministic (no subprocess stdout parsing, no serialization round-trips beyond artifacts). Engines are already pure functions; direct invocation minimizes complexity.

**Alternative Not Chosen:** Shelling out to npm commands introduces serialization/deserialization overhead, substring parsing complexity, and exit-code fragility. Rejected for v0.1.

### Â§10.2 Artifacts Are Immutable

Orchestration never modifies upstream artifacts. If `storyboard.json` is produced in run #1 and consumed in run #2's render stage, the original `storyboard.json` is read-only; the render output goes to run #2's directory.

This preserves full lineage and enables deterministic re-running from any point.

---

## 9. Determinism (Â§11 Normative)

### Â§11.1 Canonical Stage Ordering

Stages always execute in order: demo â†’ story â†’ render. This ordering is canonical and unchangeable.

### Â§11.2 Artifact Ordering

When resolving multiple artifacts of the same kind (e.g., multiple BrowserCaptureResult entries), they are sorted lexically by artifactId before use. This ensures repeated runs with the same input set produce identical output regardless of the order in which users list them in the orchestration input.

### Â§11.3 Determinism Boundary

**Byte-Identical Outputs:**
- Same orchestration input (YAML/JSON)
- Same artifact payloads (by content-hash)
- Same artifact registry state (no concurrent modifications)

**Result:** Byte-identical RenderPlan, Storyboard, ProductUnderstanding across repeated runs.

**Non-Deterministic Metadata (Explicitly Excluded):**
- `createdAt`, `executedAt`, `resolvedAt` timestamps (per RFC-0001/0005/0006 timestamp-exclusion convention for determinism checks)
- `runId` (intentionally variable per RFC-0001)
- `decisionId` (intentionally unique per decision log)

**Verification:** Determinism test runs orchestration twice with identical input, strips timestamp/runId/decisionId, and asserts `canonicalHash(output1) == canonicalHash(output2)` for all stage outputs.

---

## 10. Failure Model (Â§12 Normative)

### Â§12.1 Reason Codes

```typescript
export type ArtifactResolutionFailureReasonCode =
  | "ARTIFACT_NOT_FOUND"          // lookup returned no match
  | "ARTIFACT_KIND_MISMATCH"      // artifact exists, wrong kind
  | "ARTIFACT_HASH_MISMATCH"      // artifact exists, hash does not match
  | "ARTIFACT_SCHEMA_UNSUPPORTED" // artifact schema version not supported
  | "ARTIFACT_CORRUPTED"          // artifact shape invalid for schema
  | "ARTIFACT_AMBIGUOUS_MATCH"    // duplicate references in same input
  | "ARTIFACT_UNSAFE_PATH"        // path traversal detected
  | "REGISTRY_INACCESSIBLE";      // filesystem permission error

export type OrchestrationGateReasonCode =
  | "MANIFEST_INVALID"             // input orchestration.yaml schema invalid
  | "MANIFEST_NOT_FOUND"           // input file not found
  | "STAGE_ARTIFACT_MISSING"       // required artifact not found/resolved
  | "STAGE_ARTIFACT_HASH_MISMATCH" // required artifact hash mismatch
  | "STAGE_GATE_FAILED"            // upstream stage gate is fail
  | "STAGE_GATE_CONDITIONAL"       // upstream stage gate is conditional
  | "ARTIFACT_RESOLUTION_FAILED"   // one or more required resolutions failed
  | "LINEAGE_AMBIGUOUS"            // same artifact in multiple chains
  | "OUTPUT_REGISTRATION_FAILED"   // failed to write output artifact
  | "ORCHESTRATION_INTERRUPTED";   // user interrupt or timeout
```

### Â§12.2 Fail-Closed Behavior

- **Required artifact missing:** Orchestration gate fails; exit code 1; no partial output
- **Optional artifact missing:** Orchestration gate conditional; exit code 1; stage output still written
- **Upstream stage gate failed:** Downstream stages do not execute; orchestration gate fails
- **Hash mismatch:** Artifact rejected; orchestration fails; no recovery
- **Ambiguous reference:** Artifact resolution fails; stage does not execute

---

## 11. CLI Contract (Â§13 Normative)

### Â§13.1 Orchestration Command

```bash
npm run orchestrate-demo -- <orchestration.yaml|.json>
```

**Input:** `orchestration.yaml` or `orchestration.json` containing `PipelineOrchestrationInput`

**Output:**
- Writes all stage artifacts to `.dps/runs/<run-id>/`
- Writes `orchestration-result.json` containing `PipelineOrchestrationResult`
- Writes decision log and event log (per existing RFC-0001 convention)

**Exit Codes:**
- `0` â€” orchestration gate pass
- `1` â€” orchestration gate conditional or fail
- `2` â€” input invalid (schema validation failure)
- `3` â€” unexpected exception (not a contractual failure)

### Â§13.2 Input Format

```yaml
schemaVersion: "0.1"
id: orchestration-<uuid>
manifestPath: path/to/demo.yaml
targetStages: ["demo", "story", "render"]  # or subset
storyInputOverride:
  objective: promotional
  duration:
    targetMs: 60000
    minimumMs: 30000
    maximumMs: 120000
allowCrossRunArtifactReferences: false
```

Stages are optional; if omitted, all stages run in order.

### Â§13.3 CLI Determinism

Same orchestration input twice produces:
- Identical outputs (byte-identical stage artifacts, modulo timestamps)
- Same lineage
- Same decision log (modulo timestamps)
- Same exit code

---

## 12. Worked Example

### Story

A hypothetical team has a SaaS product and wants to create a promotional demo showing three features: onboarding, dashboard insights, and one-click export.

### Orchestration Input

**File: `examples/promotional-demo/orchestration.yaml`**

```yaml
schemaVersion: "0.1"
id: promotional-demo-july-2026
manifestPath: examples/promotional-demo/product-demo.yaml

targetStages: ["demo", "story", "render"]

storyInputOverride:
  objective: promotional
  duration:
    targetMs: 60000
    minimumMs: 45000
    maximumMs: 90000

renderConstraints:
  outputProfile:
    kind: registered
    profileArtifactId: dps-landscape-1080p30
    expectedContentHash: <hash>
  entryRequirementClassifications:
    - storyboardArtifactId: <id>
      storyboardContentHash: <hash>
      requirementIndex: 0
      requirementHash: <hash>
      classification: renderer-bound
      policy:
        id: entry-requirement-classification-policy
        version: "0.1"
```

### Execution Flow

```
1. orchestrate-demo orchestration.yaml

   Stage 1: demo (product-demo.yaml)
     â†’ Understands product (claims, features, hero interactions)
     â†’ Produces ProductUnderstanding, DIR, Plan
     â†’ Gate: pass

   Stage 2: story (auto-resolve)
     â†’ Resolves ProductUnderstanding, DIR from stage 1
     â†’ Applies storyInputOverride (objective, duration)
     â†’ Produces Storyboard (onboarding â†’ dashboard â†’ export narrative)
     â†’ Gate: pass

   Stage 3: render (auto-resolve)
     â†’ Resolves Storyboard from stage 2
     â†’ Resolves AdapterCapabilities (dps-landscape-1080p30)
     â†’ Produces RenderPlan with frame boundaries and scene geometry
     â†’ Gate: pass

   Output: .dps/runs/run-<timestamp>/
     - understanding.json (from stage 1)
     - dir.json (from stage 1)
     - storyboard.json (from stage 2)
     - render-plan.json (from stage 3)
     - render-gate.json (from stage 3)
     - orchestration-result.json (metadata and lineage)
```

**User Experience:** One command; automatic chaining; full reproducibility; can re-run any stage by saving the intermediate result.

---

## 13. Acceptance Gates (Â§14 Normative)

RFC-0007 is accepted when:

- [ ] `ArtifactReference`, `ArtifactResolution`, `ArtifactResolutionResult` typed and schema-validated
- [ ] Registry lookup algorithm deterministic and fail-closed
- [ ] Content-hash verification enforced (ARTIFACT_HASH_MISMATCH rejects)
- [ ] Wrong-kind artifact rejected (ARTIFACT_KIND_MISMATCH)
- [ ] Missing-artifact rejected (ARTIFACT_NOT_FOUND)
- [ ] Duplicate references rejected (ARTIFACT_AMBIGUOUS_MATCH)
- [ ] Unsafe path detection prevents directory traversal
- [ ] Blocked upstream gate propagates to downstream (fail-closed)
- [ ] Deterministic repeated execution produces byte-identical outputs (modulo timestamps)
- [ ] Immutable upstream artifacts (no read-write, no mutation)
- [ ] Full test suite passes (RFC-0001â€“0006 tests + new RFC-0007 tests)
- [ ] No implementation of rendering or MP4 export
- [ ] One complete end-to-end example runs successfully
- [ ] orchestration-result.json includes full lineage edges
- [ ] Decision log records each artifact resolution

---

## 14. Test Plan (Â§15 Normative)

### Â§15.1 Unit Tests

- **Artifact Resolution:**
  - Lookup finds artifact by ID in registry
  - Lookup rejects missing artifact (ARTIFACT_NOT_FOUND)
  - Hash verification passes for matching hash
  - Hash verification rejects mismatch (ARTIFACT_HASH_MISMATCH)
  - Kind validation passes for correct kind
  - Kind validation rejects wrong kind (ARTIFACT_KIND_MISMATCH)
  - Cross-run lookup uses most-recent run (deterministic ordering)

- **Determinism:**
  - Same orchestration input twice â†’ byte-identical outputs
  - Artifact ordering (lexical by artifactId) is stable
  - Timestamps are excluded from determinism check

- **Fail-Closed:**
  - Required artifact missing â†’ stage fails
  - Optional artifact missing â†’ stage conditional
  - Upstream gate fail â†’ downstream skipped
  - Hash mismatch â†’ stage fails

### Â§15.2 Schema Tests

- `orchestration-input.schema.json` validates input
- `orchestration-result.schema.json` validates output
- `artifact-reference.schema.json` validates references
- `artifact-resolution-result.schema.json` validates resolution

### Â§15.3 CLI Integration Tests

- `npm run orchestrate-demo -- examples/promotional-demo/orchestration.yaml` runs end-to-end
- Produces `.dps/runs/<run-id>/storyboard.json` and `render-plan.json`
- Exit code 0 for pass
- Exit code 1 for conditional/fail
- Exit code 2 for invalid input

### Â§15.4 Determinism Test

- Run orchestration twice with identical input
- Strip timestamps/runIds
- Assert `canonicalHash(run1.storyboard) == canonicalHash(run2.storyboard)`
- Assert `canonicalHash(run1.renderPlan) == canonicalHash(run2.renderPlan)`

### Â§15.5 Adversarial Tests

- Path traversal attempt (../../etc/passwd) â†’ rejected
- Corrupted artifact (invalid JSON) â†’ ARTIFACT_CORRUPTED
- Duplicate artifact references â†’ ARTIFACT_AMBIGUOUS_MATCH
- Circular artifact dependency â†’ rejected
- Wrong schema version â†’ ARTIFACT_SCHEMA_UNSUPPORTED

---

## 15. CLI Naming (Â§16 Normative)

The primary orchestration command is:

```bash
npm run orchestrate-demo -- <path-to-orchestration.yaml>
```

**Naming rationale:** Follows existing CLI naming (demo, analyze-demo, capture-browser, compile-story, compile-render). The `orchestrate-` prefix and `-demo` suffix follow the pattern and indicate this is the unified orchestration entrypoint.

**Alternative considered:** `npm run build-demo` â€” rejected because "build" carries compile/transpile connotations; orchestration is purely chaining and resolution, not transformation.

---

## 16. Schemas (Â§17 Normative)

New schema files:

- `schemas/orchestration-input.schema.json` â€” PipelineOrchestrationInput
- `schemas/orchestration-result.schema.json` â€” PipelineOrchestrationResult
- `schemas/artifact-reference.schema.json` â€” ArtifactReference
- `schemas/artifact-resolution-result.schema.json` â€” ArtifactResolutionResult
- `schemas/orchestration-gate.schema.json` â€” OrchestrationGate

All existing RFC-0001â€“0006 schemas remain unchanged.

---

## Appendix A: Moved Non-Goals (Future RFCs)

This RFC explicitly excludes:

- **RFC-0008 (Renderer Adapter):** Remotion integration, MP4 export, post-render validation
- **Auxiliary Tracks:** Audio mixing, voiceover, music (deferred; infrastructure ready in RFC-0006 type signatures)
- **Advanced Asset Preparation:** Real image/video transformation (RFC-0006 mock remains; real service future work)
- **Implicit Semantic Inference:** Auto-derivation of bindings from Storyboard presentation intent (caller-declared remains; auto-derivation future work)

---

## Appendix B: Known Limitations (Honest Boundary)

1. **Filesystem-Only Registry** â€” No network, cloud, or database backend in v0.1. Supports `.dps/runs/` and sibling-run lookup only.
2. **Single-Machine Execution** â€” No distributed execution, caching, or remote workers. In-process orchestration only.
3. **No Interactive Recovery** â€” Fail-closed on any error; no prompt-based recovery or manual override flow. User must fix input and re-run.
4. **Cross-Run References Optional** â€” Default behavior is single-run isolation; cross-run requires explicit flag.
5. **No Partial Replay** â€” Must re-run full orchestration; cannot easily replay just one stage without manual artifact assembly.

All limitations are narrower than v0.2 scope; none violate the RFC's normative requirements.

---

**END OF RFC-0007 SPECIFICATION**
