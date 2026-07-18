# RFC-0007 — Artifact Resolution and Pipeline Orchestration v0.1

Status: **Specification for implementation**
Depends on: RFC-0001 through RFC-0006
Primary input: Registered artifacts in `.dps/runs/<run-id>/`, deterministic CLI input
Primary output: Chained stage outputs without manual payload assembly

---

## 1. Status and Executive Summary

RFC-0001 through RFC-0006 have built individual stages of the demo-production pipeline. Each stage produces deterministic, immutable artifacts; each is independently testable and contractually sound.

However, the stages are not automatically chained. A user who wants to run:
1. `npm run demo` → `compile-story` → `compile-render`

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
| Understanding | `demo.yaml` (manifest) | `ProductUnderstanding`, `DemoIntermediateRepresentation`, `Plan`, decision log | `npm run demo` |
| Story | `story-input.yaml` (StoryCompilerInput) | `Storyboard`, decision log | `npm run compile-story` |
| Render | `render-input.yaml` (RenderCompilerBundle) | `RenderPlan`, `RenderGate`, `ResolvedRenderAssets`, decision log | `npm run compile-render` |

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

1. **Artifact Resolution Semantics** — Typed, deterministic rules for resolving artifact IDs to registered payloads
2. **Registry Query Interface** — Read-only artifact lookup from `.dps/runs/<run-id>/` by artifactId + expectedContentHash
3. **Lineage Preservation** — Full provenance chain recorded in decision logs; no artifact is ever mutated
4. **Pipeline Orchestration** — Single coordinated entry point that chains stages without user intervention
5. **Deterministic Stage Ordering** — Canonical order, failure modes, and artifact binding order
6. **Fail-Closed Semantics** — Missing, stale, ambiguous, or hash-mismatched artifacts explicitly reject; no silent fallbacks
7. **Cross-Run References** — Optional ability to reference artifacts from prior runs (same registry)
8. **Worked End-to-End Example** — One complete demo from input through Storyboard + RenderPlan
9. **CLI Orchestration Command** — User-facing interface for chained execution
10. **Determinism Guarantees** — Same input run twice produces byte-identical RenderPlan (modulo timestamps excluded per prior RFCs)
11. **Immutability Enforcement** — Upstream artifacts remain read-only; no mutation by downstream stages
12. **Decision Log Integration** — Each orchestration decision (artifact resolution, stage execution, lineage binding) is recorded
13. **Typed Contracts** — Close artifact-reference and orchestration types; no stringly-typed lookups

---

## 4. Non-Goals

RFC-0007 MUST NOT:

- Introduce a Remotion renderer adapter or any renderer-specific logic
- Render frames or export MP4
- Implement post-render validation
- Modify the contracts of RFC-0001–0006 (only add orchestration and resolution on top)
- Implement asynchronous execution, parallel stages, or caching beyond the filesystem registry
- Add network-based or cloud artifact resolution (filesystem-only in v0.1)
- Implement implicit semantic inference (e.g., auto-derive bindings from Storyboard presentation intent)
- Mutate existing immutable artifacts
- Change story mode, arc, claims, proof chains, evidence, or narrative structure mid-pipeline

---

## 5. Contracts

### §1 Standard Artifact IDs and Deterministic Binding (Normative)

RFC-0007 uses **Approach B: Deterministic Standard ArtifactIds**.

Every stage produces outputs with standard, deterministic artifactIds. Downstream stages resolve these standard IDs from the registry without explicit caller specification in PipelineOrchestrationInput.

**Standard ArtifactId Mapping (Normative):**

| Stage | Standard Output ArtifactIds | Persisted | Available for Cross-Run Reference |
|---|---|---|---|
| demo | `understanding`, `dir`, `plan` | Yes | Yes |
| story | `storyboard` | Yes | Yes |
| render | `render-plan`, `render-gate`, `resolved-assets` | Yes | Yes |

**Binding Rule (Normative):** When stage N+1 executes, it automatically resolves stage N's outputs by their standard IDs from the registry using §8 resolution semantics. No caller input specifies which artifacts to bind; the bindings are deterministic by stage ordering alone.

**Rationale:** This approach keeps orchestration logic thin: stages produce artifacts with known IDs, and downstream stages look them up by name. No explicit artifact-reference fields are needed in PipelineOrchestrationInput; orchestration discovers artifacts by their standard names.

---

### §2 Artifact Reference

An artifact reference is a typed, immutable pointer to a registered artifact. ArtifactReference is used for:
- Explicit cross-run artifact lookups (when allowCrossRunReferences: true)
- Caller-supplied input artifacts (e.g., existing demo analysis, browser capture results from external sources)
- Tracking resolved artifact provenance

Note: Standard stage outputs use their deterministic artifactIds (§1); ArtifactReference is primarily for non-standard or cross-run sources.

```typescript
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

### §3 Pipeline Orchestration Input and Result

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
  | "LINEAGE_AMBIGUOUS"
  | "OUTPUT_REGISTRATION_FAILED"
  | "ORCHESTRATION_INTERRUPTED";

export type LineageEdge = {
  readonly sourceStage: "demo" | "story" | "render";
  readonly targetStage: "demo" | "story" | "render";
  readonly sourceRunId?: string;
  readonly resolvedAt: ISODateTime;
};
```

**Artifact Kinds Not in ArtifactReference:** The following are not persisted as artifacts or are inline configuration:
- RenderAssetCandidateRecord[], RenderBindingRequest[], RenderTextLayerRequest[], EntryRequirementClassification[] — these are optional caller-supplied inputs to stages, not artifacts persisted to the registry. They are passed inline in PipelineOrchestrationInput overrides.

---

## 6. Resolution Semantics (§8 Normative)

### §8.1 Standard Artifact Resolution

For standard stage outputs (listed in §1), orchestration resolves them by their standard artifactIds automatically:

```
For stage N, lookup standard outputs:
  1. For each standard artifactId in §1 mapping:
       a. Check <registryRootPath>/<artifactId>.json
       b. Check <registryRootPath>/<artifactId>.yaml
       c. If allowCrossRunReferences and not found:
          - Enumerate sibling runs in `.dps/runs/`
          - For each run in reverse chronological order (newest first):
            - Check <sibling>/<artifactId>.json
            - Check <sibling>/<artifactId>.yaml
            - Use first match (most recent run)
       d. If not found and required: emit ARTIFACT_NOT_FOUND
       e. If not found and optional: report as missing but continue
```

**Deterministic Ordering:** Cross-run lookups use reverse chronological order (newest first) and break ties by run-id lexical ordering. This ensures repeated execution selects the same artifact (given no new runs are added between executions).

### §8.2 Content-Hash Verification

Every resolved artifact must be verified:

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

### §8.3 Schema and Kind Validation

After hash verification:

```
1. Load artifact type from payload.schemaVersion
2. Verify artifact.kind matches ArtifactReference.kind
3. If mismatch: emit ARTIFACT_KIND_MISMATCH; fail
4. If schema version not supported: emit ARTIFACT_SCHEMA_UNSUPPORTED; fail
5. Validate artifact shape against JSON Schema in schemas/<kind>.schema.json
6. If invalid: emit ARTIFACT_CORRUPTED; fail
```

### §8.4 Duplicate and Ambiguous References

Within a single orchestration run, two artifact references to different artifactIds with identical expectedContentHash is allowed only if they are not in a mutual consumer relationship. Duplicates in the same consumer chain are ambiguous:

```
If detectDuplicate(reference1, reference2) where both are in same stage input:
  - Emit ARTIFACT_AMBIGUOUS_MATCH
  - Fail the stage (fail-closed)
```

### §8.5 Required vs. Optional Artifacts and Deterministic Failure Behavior

**Required artifacts (normative):**

```
IF a required artifact resolution fails (ARTIFACT_NOT_FOUND, ARTIFACT_HASH_MISMATCH, 
ARTIFACT_KIND_MISMATCH, ARTIFACT_SCHEMA_UNSUPPORTED, ARTIFACT_CORRUPTED):
  THEN stage execution fails
  AND orchestration gate status becomes fail
  AND downstream stages do NOT execute
```

**Optional artifacts (normative):**

```
IF an optional artifact resolution fails:
  THEN stage execution status becomes conditional
  AND the artifact is reported as missing in outputArtifactIds
  AND orchestration continues
  AND downstream stages may proceed if their required inputs are available
```

**Current v0.1 artifact requirements** (derived from RFC contracts):

| Reference | Requirement | Stage |
|---|---|---|
| ProductUnderstanding | Required | story |
| DemoIntermediateRepresentation | Required | story |
| ExistingDemoAnalysis | Optional | story |
| BrowserCaptureResult[] | Required (array may be empty) | story |
| Storyboard | Required | render |
| AdapterCapabilities | Required | render |
| RenderOutputProfile | Optional (inline custom allowed) | render |
| RenderOverrideRecord[] | Optional | render |

**Upstream gate propagation (normative):**

```
IF upstream stage gate status == fail:
  THEN downstream stages do NOT execute
  AND orchestration gate status becomes fail
  AND reason code is STAGE_GATE_FAILED

IF upstream stage gate status == conditional:
  THEN downstream stages may proceed
  AND if downstream stage has all required inputs available
  AND orchestration tracks that downstream inherited conditional status
```

### §8.6 Cross-Run References

By default, artifact resolution stays within a single run. If `allowCrossRunReferences: true`:

```
1. Search within requestedRunId first (current run)
2. If not found and allowCrossRunReferences:
     a. Enumerate sibling runs in `.dps/runs/`
     b. For each run in reverse chronological order (newest first):
        - Check <sibling>/<artifactId>.json
        - Check <sibling>/<artifactId>.yaml
     c. Use first match (most recent run)
3. If found in sibling run:
   - Include sourceRunId in ArtifactResolution
   - Record lineage edge with source run ID
   - Proceed normally (hash check, validation, etc.)
4. Include full lineage in final PipelineOrchestrationResult
```

**Determinism note:** Cross-run determinism requires stable artifact registry state (no new runs created between repeated executions of the same orchestration input).

---

## 7. Stage Graph and Lineage (§9 Normative)

### §9.1 Canonical Stage Ordering

The demo-production pipeline has one canonical ordering:

```
1. demo: demo.yaml → [UnderstandingEngine, PlanningEngine, DIRCompiler]
         → understanding, dir, plan artifacts

2. story: [Resolve: understanding, dir, existingDemoAnalysis?, browserCaptures?]
          → [StoryEngine]
          → storyboard artifact

3. render: [Resolve: storyboard, adapterCapabilities, profiles, bindings, overrides]
           → [RenderEngine]
           → render-plan, render-gate, resolved-assets artifacts
```

Stages must be executed in this order. Out-of-order execution is rejected.

### §9.2 Lineage Edges (Stage-Level Relationships)

Lineage tracks **stage relationships**, not individual artifact flows. Every stage execution in the orchestration result carries lineage metadata recording which upstream stages it depended on:

```
LineageEdge represents a stage boundary:
  demo → story (if story is requested)
  demo → render (if render is requested, story was skipped)
  story → render (if both executed in order)
```

Each LineageEdge captures:
- sourceStage: which stage produced artifacts
- targetStage: which stage consumed them
- sourceRunId: if cross-run reference
- resolvedAt: when the resolution occurred

This provides full auditability of stage composition without tracking artifact-by-artifact dependencies. Lineage is recorded in decision logs for full auditability.

### §9.3 Artifact Binding Rules

When stage N+1 executes after stage N:

1. **Automatic** — stage N+1 automatically resolves stage N's standard outputs (§1) by their known artifactIds; no manual configuration required
2. **Deterministic** — same stage ordering always produces the same artifact bindings
3. **Immutable** — upstream artifacts are never re-produced or modified; only read

---

## 8. Orchestration Semantics (§10 Normative)

### §10.1 In-Process Execution

RFC-0007 v0.1 specifies in-process orchestration:

```
Orchestration CLI
  → Loads PipelineOrchestrationInput (YAML/JSON)
  → Instantiates FilesystemArtifactRegistry
  → For each requested stage in order:
       1. Resolve standard artifact IDs (§8.1) via registry lookup
       2. Invoke engine in-process (UnderstandingEngine, StoryEngine, RenderEngine)
       3. Register output artifacts with standard IDs (§1)
       4. Record lineage edges and decision log
       5. Check gate status; fail-closed if blocking gate fails (§8.5)
       6. Proceed to next stage or abort
  → Write PipelineOrchestrationResult to registry
  → Return exit code based on OrchestrationGate.status
```

**Why:** Keeps orchestration deterministic (no subprocess stdout parsing, no serialization round-trips beyond artifacts). Engines are already pure functions; direct invocation minimizes complexity.

### §10.2 Artifacts Are Immutable

Orchestration never modifies upstream artifacts. If `storyboard.json` is produced in run #1 and consumed in run #2's render stage, the original `storyboard.json` is read-only; the render output goes to run #2's directory.

This preserves full lineage and enables deterministic re-running from any point.

---

## 9. Determinism (§11 Normative)

### §11.1 Canonical Stage Ordering

Stages always execute in order: demo → story → render. This ordering is canonical and unchangeable.

### §11.2 Artifact Ordering

When resolving multiple artifacts of the same kind (e.g., multiple BrowserCaptureResult entries), they are sorted lexically by artifactId before use. This ensures repeated runs with the same input set produce identical output regardless of the order in which users list them in the orchestration input.

### §11.3 Determinism Boundary

**Byte-Identical Outputs (guaranteed when):**
- Same orchestration input (YAML/JSON)
- Same artifact payloads (by content-hash)
- Same artifact registry state within a run
- allowCrossRunReferences is false (default)

**Result:** Byte-identical RenderPlan, Storyboard, ProductUnderstanding across repeated runs within the same registry snapshot.

**Non-Deterministic Metadata (Explicitly Excluded):**
- `createdAt`, `executedAt`, `resolvedAt` timestamps (per RFC-0001/0005/0006 timestamp-exclusion convention)
- `runId` (intentionally variable per RFC-0001)
- `decisionId` (intentionally unique per decision log)

**Cross-Run Determinism Note:** When `allowCrossRunReferences: true`, determinism requires stable artifact registry state (no new runs added between repeated executions). This is a requirement for reproducibility, not a bug; users should disable cross-run references or snapshot the registry if determinism is critical.

**Verification:** Determinism test runs orchestration twice with identical input, strips timestamp/runId/decisionId, and asserts `canonicalHash(output1) == canonicalHash(output2)` for all stage outputs.

---

## 10. Failure Model (§12 Normative)

### §12.1 Reason Codes

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
  | "LINEAGE_AMBIGUOUS"            // same artifact in multiple chains
  | "OUTPUT_REGISTRATION_FAILED"   // failed to write output artifact
  | "ORCHESTRATION_INTERRUPTED";   // user interrupt or timeout
```

### §12.2 Fail-Closed Behavior (Normative)

- **Required artifact missing or hash-mismatched:** Stage fails → orchestration gate fails → exit code 1 → no downstream execution
- **Optional artifact missing or hash-mismatched:** Stage conditional → continue → downstream may proceed if required inputs available
- **Upstream stage gate failed:** Downstream stages do not execute → orchestration gate fails
- **Upstream stage gate conditional:** Downstream may proceed if they can satisfy their required inputs from available artifacts
- **Hash mismatch on any artifact:** Reject immediately; orchestration fails; no recovery

---

## 11. CLI Contract (§13 Normative)

### §13.1 Orchestration Command

```bash
npm run orchestrate-demo -- <orchestration.yaml|.json>
```

**Input:** `orchestration.yaml` or `orchestration.json` containing `PipelineOrchestrationInput`

**Output:**
- Writes all stage artifacts to `.dps/runs/<run-id>/`
- Writes `orchestration-result.json` containing `PipelineOrchestrationResult`
- Writes decision log and event log (per existing RFC-0001 convention)

**Exit Codes:**
- `0` — orchestration gate pass
- `1` — orchestration gate conditional or fail
- `2` — input invalid (schema validation failure)
- `3` — unexpected exception (not a contractual failure)

### §13.2 Input Format

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

### §13.3 CLI Determinism

Same orchestration input twice produces (within stable registry state):
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
     → Understands product (claims, features, hero interactions)
     → Produces understanding, dir, plan artifacts
     → Gate: pass

   Stage 2: story (auto-resolve from stage 1)
     → Resolves understanding, dir artifacts by standard IDs
     → Applies storyInputOverride (objective, duration)
     → Produces storyboard artifact
     → Gate: pass

   Stage 3: render (auto-resolve from stage 2)
     → Resolves storyboard artifact by standard ID
     → Resolves adapterCapabilities (dps-landscape-1080p30)
     → Produces render-plan, render-gate, resolved-assets artifacts
     → Gate: pass

   Output: .dps/runs/run-<timestamp>/
     - understanding.json (from stage 1)
     - dir.json (from stage 1)
     - plan.json (from stage 1)
     - storyboard.json (from stage 2)
     - render-plan.json (from stage 3)
     - render-gate.json (from stage 3)
     - resolved-assets.json (from stage 3)
     - orchestration-result.json (metadata and lineage)
```

**User Experience:** One command; automatic artifact chaining via standard IDs; full reproducibility; can re-run any stage by saving the intermediate result.

---

## 13. Acceptance Gates (§14 Normative)

RFC-0007 is accepted when:

- [ ] PipelineOrchestrationInput accepts manifestPath and targetStages (artifact references via standard IDs)
- [ ] Standard artifactId mapping (§1) is enforced: demo produces `understanding`, `dir`, `plan`; story produces `storyboard`; render produces `render-plan`, `render-gate`, `resolved-assets`
- [ ] Registry lookup algorithm is deterministic and fail-closed
- [ ] Content-hash verification enforced (ARTIFACT_HASH_MISMATCH rejects)
- [ ] Wrong-kind artifact rejected (ARTIFACT_KIND_MISMATCH)
- [ ] Missing required artifact rejected (ARTIFACT_NOT_FOUND → stage fails)
- [ ] Missing optional artifact handled correctly (conditional → continue)
- [ ] Duplicate references rejected (ARTIFACT_AMBIGUOUS_MATCH)
- [ ] Unsafe path detection prevents directory traversal
- [ ] Blocked upstream gate propagates to downstream (fail-closed)
- [ ] Upstream conditional gate allows downstream to proceed if required inputs available
- [ ] Deterministic repeated execution produces byte-identical outputs (modulo timestamps, when allowCrossRunReferences: false)
- [ ] Immutable upstream artifacts (no read-write, no mutation)
- [ ] Full test suite passes (RFC-0001–0006 tests + new RFC-0007 tests)
- [ ] No implementation of rendering or MP4 export
- [ ] One complete end-to-end example runs successfully
- [ ] orchestration-result.json includes full lineage edges
- [ ] Decision log records each artifact resolution

---

## 14. Test Plan (§15 Normative)

### §15.1 Unit Tests

- **Standard Artifact Resolution:**
  - Lookup finds artifact by standard ID in registry
  - Lookup rejects missing required artifact (ARTIFACT_NOT_FOUND)
  - Hash verification passes for matching hash
  - Hash verification rejects mismatch (ARTIFACT_HASH_MISMATCH)
  - Kind validation passes for correct kind
  - Kind validation rejects wrong kind (ARTIFACT_KIND_MISMATCH)
  - Cross-run lookup uses most-recent run (deterministic ordering)

- **Failure Behavior:**
  - Required artifact missing → stage fails → downstream skipped
  - Optional artifact missing → stage conditional → downstream proceeds if required inputs available
  - Upstream gate fail → downstream skipped
  - Upstream gate conditional → downstream proceeds if required inputs available
  - Hash mismatch → stage fails

- **Determinism:**
  - Same orchestration input twice → byte-identical outputs
  - Artifact ordering (lexical by artifactId) is stable
  - Timestamps are excluded from determinism check

### §15.2 Schema Tests

- `orchestration-input.schema.json` validates input
- `orchestration-result.schema.json` validates output
- `artifact-reference.schema.json` validates references
- `artifact-resolution-result.schema.json` validates resolution

### §15.3 CLI Integration Tests

- `npm run orchestrate-demo -- examples/promotional-demo/orchestration.yaml` runs end-to-end
- Produces `.dps/runs/<run-id>/storyboard.json` and `render-plan.json`
- Exit code 0 for pass
- Exit code 1 for conditional/fail
- Exit code 2 for invalid input

### §15.4 Determinism Test

- Run orchestration twice with identical input
- Strip timestamps/runIds/decisionIds
- Assert `canonicalHash(run1.storyboard) == canonicalHash(run2.storyboard)`
- Assert `canonicalHash(run1.renderPlan) == canonicalHash(run2.renderPlan)`

### §15.5 Adversarial Tests

- Path traversal attempt (../../etc/passwd) → rejected
- Corrupted artifact (invalid JSON) → ARTIFACT_CORRUPTED
- Duplicate artifact references → ARTIFACT_AMBIGUOUS_MATCH
- Circular artifact dependency → rejected
- Wrong schema version → ARTIFACT_SCHEMA_UNSUPPORTED

---

## 15. CLI Naming (§16 Normative)

The primary orchestration command is:

```bash
npm run orchestrate-demo -- <path-to-orchestration.yaml>
```

**Naming rationale:** Follows existing CLI naming (demo, analyze-demo, capture-browser, compile-story, compile-render). The `orchestrate-` prefix and `-demo` suffix follow the pattern and indicate this is the unified orchestration entrypoint.

---

## 16. Schemas (§17 Normative)

New schema files:

- `schemas/orchestration-input.schema.json` — PipelineOrchestrationInput
- `schemas/orchestration-result.schema.json` — PipelineOrchestrationResult
- `schemas/artifact-reference.schema.json` — ArtifactReference
- `schemas/artifact-resolution-result.schema.json` — ArtifactResolutionResult
- `schemas/orchestration-gate.schema.json` — OrchestrationGate

All existing RFC-0001–0006 schemas remain unchanged.

---

## Appendix A: Moved Non-Goals (Future RFCs)

This RFC explicitly excludes:

- **RFC-0008 (Renderer Adapter):** Remotion integration, MP4 export, post-render validation
- **Auxiliary Tracks:** Audio mixing, voiceover, music (deferred; infrastructure ready in RFC-0006 type signatures)
- **Advanced Asset Preparation:** Real image/video transformation (RFC-0006 mock remains; real service future work)
- **Implicit Semantic Inference:** Auto-derivation of bindings from Storyboard presentation intent (caller-declared remains; auto-derivation future work)

---

## Appendix B: Known Limitations (Honest Boundary)

1. **Filesystem-Only Registry** — No network, cloud, or database backend in v0.1. Supports `.dps/runs/` and sibling-run lookup only.
2. **Single-Machine Execution** — No distributed execution, caching, or remote workers. In-process orchestration only.
3. **No Interactive Recovery** — Fail-closed on any error; no prompt-based recovery or manual override flow. User must fix input and re-run.
4. **Cross-Run References Optional** — Default behavior is single-run isolation; cross-run requires explicit flag and stable registry state.
5. **No Partial Replay** — Must re-run full orchestration; cannot easily replay just one stage without manual artifact assembly.

All limitations are narrower than v0.2 scope; none violate the RFC's normative requirements.

---

**END OF RFC-0007 SPECIFICATION v0.2**
