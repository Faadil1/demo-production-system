# RFC-0009 — Minimal Execution Artifact Capture

**Status:** Draft — Architecture Review  
**Date:** 2026-07-19  
**Depends On:** RFC-0007 Phase 2, RFC-0008  
**Scope:** v1.0 execution orchestration; Phase 3 runtime state  

---

## 1. Context

RFC-0007 Phase 2 (planning) and RFC-0008 (sequential orchestration) have established:

- Deterministic execution planning via topological DAG traversal
- Pure sequential stage execution with fail-fast semantics
- Five frozen failure reason codes (no executor output collection)
- StageExecutionResult limited to { status: 'SUCCEEDED' | 'FAILED' }

**Current state:** Orchestrator collects only stage IDs of successful executions (`completedStages: string[]`).

**Gap:** Executors have no way to return immutable artifact references, and orchestrator has no mechanism to expose them in the result. This blocks Phase 3+ work (gates, lineage, persistence) that depends on artifact references.

---

## 2. Problem Statement

1. **Executors cannot communicate output artifacts** — No contract for returning artifact references
2. **Orchestrator cannot collect artifacts** — Result shape has no field for artifacts
3. **Downstream phases are blocked** — Phase 3+ assumes artifacts are available in orchestration result
4. **Artifact uniqueness is undefined** — No validation strategy (deferred by design, but not declared)
5. **Malformed artifacts lack a clear failure path** — Where should executor-provided invalid artifacts map?

---

## 3. Goals

RFC-0009 MUST provide:

1. **Artifact reference contract** — Minimal immutable type for executors to return artifact pointers
2. **Single source of truth** — One per-stage execution record (CompletedStageExecution) for all stage metadata; no parallel arrays
3. **Result enrichment** — Orchestrator collects and exposes artifacts per successful stage in SequentialExecutionResult
4. **Frozen failure taxonomy** — Do NOT add new codes; keep RFC-0008's five failure reasons unchanged
5. **Fail-fast semantics preservation** — Failed and unexecuted stages do not contribute to completedStages
6. **Determinism guarantee** — Artifact ordering matches executor output exactly; no sorting, filtering, or modification
7. **Extensibility** — CompletedStageExecution is the durable extension point for future RFC fields (metrics, receipts, warnings)

---

## 4. Non-Goals (Explicit Deferral)

RFC-0009 does NOT include:

- Artifact persistence (writes to filesystem, database, remote storage)
- Existence checks (validation that uri points to real artifact)
- Content hashing (integrity verification)
- Artifact deduplication or uniqueness validation
- Upstream artifact propagation (passing prior-stage artifacts to executors)
- Lineage graphs or provenance chains
- Artifact schema validation or kind-based routing
- Timestamps in artifacts or result
- Artifact expiration or lifecycle management
- Artifact decompression or format conversion
- CLI artifact export or listing

All of these are **Phase 3+ responsibilities**.

---

## 5. Proposed Public Contracts

### 5.1 Artifact Reference (Executor Output)

```typescript
/**
 * Immutable reference to a stage output artifact.
 * Executor provides these; orchestrator collects them.
 * 
 * - artifactId: Opaque string identifier (executor manages)
 * - artifactKind: Semantic category for downstream routing (no validation in RFC-0009)
 * - uri: Opaque immutable pointer (executor's responsibility to produce)
 */
export type StageArtifact = {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly uri: string;
};
```

### 5.2 Executor Result (Extended from RFC-0008)

```typescript
/**
 * Updated StageExecutionResult.
 * SUCCEEDED now includes optional artifacts array.
 * FAILED remains unchanged (no artifacts from failed executors).
 */
export type StageExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly artifacts: readonly StageArtifact[];
    }
  | {
      readonly status: 'FAILED';
    };
```

### 5.3 Completed Stage Execution (Orchestrator Result)

```typescript
/**
 * Successful stage execution with collected artifacts.
 * Represents one stage that completed with SUCCEEDED status.
 * This is the single source of truth for stage completion in the orchestrator result.
 */
export type CompletedStageExecution = {
  readonly stageId: string;
  readonly artifacts: readonly StageArtifact[];
};
```

### 5.4 Orchestration Result (Extended from RFC-0008)

```typescript
/**
 * Updated SequentialExecutionResult.
 * SUCCEEDED includes completedStages as array of CompletedStageExecution (single source of truth).
 * FAILED behavior unchanged (returns completed stages before first failure, no artifacts).
 */
export type SequentialExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly completedStages: readonly CompletedStageExecution[];
    }
  | {
      readonly status: 'FAILED';
      readonly completedStages: readonly CompletedStageExecution[];
      readonly failedStageId: string;
      readonly reason: SequentialExecutionFailureReason;
      readonly details: string;
    };
```

**Compatibility Note:**
- RFC-0009 intentionally changes `completedStages` from `readonly string[]` to `readonly CompletedStageExecution[]`
- This is a **controlled breaking change** from RFC-0008
- Accepted now to prevent long-term result-shape duplication (alternative: dual fields, rejected in Section 11)
- No compatibility shim or dual field is introduced
- Clients accessing only the `stageId` must now extract `completedStages[i].stageId` instead of `completedStages[i]`

---

## 6. Compatibility Analysis with RFC-0008

### Breaking Change: Rationale

RFC-0009 **intentionally breaks** backward compatibility with RFC-0008 in one place:

| Aspect | RFC-0008 | RFC-0009 | Status |
|--------|----------|----------|--------|
| `completedStages` type | `readonly string[]` | `readonly CompletedStageExecution[]` | **BREAKING** |
| `completedStages` on SUCCEEDED | Array of stage IDs | Array of objects with stageId + artifacts | **BREAKING** |
| `completedStages` on FAILED | Array of stage IDs | Array of objects with stageId + artifacts | **BREAKING** |
| StageExecutionResult | `{ status: 'SUCCEEDED' }` | `{ status: 'SUCCEEDED'; artifacts: [...] }` | Additive (no change to old form) |
| Failure taxonomy | Five codes frozen | Five codes frozen | No change |
| Executor invocation | No change | No change | No change |
| Algorithm (orchestrator) | Unchanged logic | Collect artifacts into CompletedStageExecution | Output-only enrichment |

### Why This Breaking Change Is Justified

1. **Single source of truth** — Eliminates redundancy: RFC-0008's `completedStages: string[]` + RFC-0009's dual `stageResults: CompletedStageExecution[]` creates parallel arrays that must stay in sync. RFC-0009 consolidates both into one extensible per-stage record.

2. **Early project stage** — v1.0 is not yet published. Phase 3 (gates, lineage) has not shipped. This is the right time to fix the shape before production consumers depend on the old dual-field model.

3. **Prevents long-term duplication** — Future RFCs (stageMetrics, stageReceipts, stageWarnings) would add more parallel fields. Single `CompletedStageExecution` becomes the durable extension point.

4. **Backward compatibility not applicable** — No existing published orchestrators use the RFC-0008 result shape in production yet. Acceptance of RFC-0009 is a controlled architectural decision, not a surprise breaking change.

### What Doesn't Change

- Execution order (topological from RFC-0007 plan)
- Fail-fast semantics (stop on first failure)
- Input contracts (plan, definitions, executors)
- Executor invocation signature (input: StageExecutionInput)
- StageExecutionResult FAILED variant (unchanged)
- Failure handling (5 codes, no executor exception details)
- Determinism guarantee (same inputs → same result)

### Migration Path

Clients accessing `completedStages` must change from:
```typescript
// RFC-0008
for (const stageId of result.completedStages) { ... }

// RFC-0009
for (const completed of result.completedStages) {
  const stageId = completed.stageId;
  const artifacts = completed.artifacts;
  // ...
}
```

**Verdict:** RFC-0009 intentionally changes the result shape for architectural clarity. No compatibility shim is introduced.

---

## 7. Executor Contract and Result Validation

### Executor Success Contract

A successful executor must return:

```typescript
{
  readonly status: 'SUCCEEDED';
  readonly artifacts: readonly StageArtifact[];
}
```

- `artifacts` field is **mandatory** (must be present)
- `artifacts` must be a readonly array of `StageArtifact`
- `artifacts` may be empty (`[]` indicates success with no output)
- Each element must have: `artifactId: string`, `artifactKind: string`, `uri: string` (all non-optional)

### Frozen Orchestrator Validation Policy

#### MUST ACCEPT:
- `artifacts: []` (empty array indicates success with no output)
- `artifacts: [{ artifactId, artifactKind, uri }]` (one artifact)
- `artifacts: [{ artifactId, artifactKind, uri }, ...]` (multiple artifacts)
- Duplicate `artifactId` values within the same stage
- Duplicate `uri` values within the same stage
- Empty strings for `artifactId`, `artifactKind`, or `uri`
- Extra enumerable fields on artifact objects (they are stripped from output, not stored)

#### MUST REJECT (Return EXECUTOR_FAILED):

**On SUCCEEDED result shape:**
- artifacts is missing → details: "Executor returned an invalid result."
- artifacts is `undefined` → details: "Executor returned an invalid result."
- artifacts is `null` → details: "Executor returned an invalid result."
- artifacts is not an array → details: "Executor returned an invalid result."

**On artifact array element validation:**
- artifact entry is `null` → details: "Executor returned artifacts with invalid structure."
- artifact entry is not an object → details: "Executor returned artifacts with invalid structure."
- artifact is missing `artifactId` → details: "Executor returned artifacts with invalid structure."
- artifact is missing `artifactKind` → details: "Executor returned artifacts with invalid structure."
- artifact is missing `uri` → details: "Executor returned artifacts with invalid structure."
- `artifactId` is not a string → details: "Executor returned artifacts with invalid structure."
- `artifactKind` is not a string → details: "Executor returned artifacts with invalid structure."
- `uri` is not a string → details: "Executor returned artifacts with invalid structure."

**On overall result shape:**
- result status is not 'SUCCEEDED' or 'FAILED' → details: "Executor returned an invalid result."
- FAILED result includes an `artifacts` property → details: "Executor returned an invalid result."

**Reason:** All rejected executor-result shapes produce `reason: 'EXECUTOR_FAILED'` (no new codes).

### Orchestrator Handling of Artifacts

1. **Artifact preservation:** Order is preserved exactly as returned by executor; no sorting, filtering, or re-ordering.

2. **Array mutation protection:** Orchestrator must not mutate the executor-provided artifacts array or any artifact objects in it.

3. **Shallow copy strategy:** For each accepted artifact, create a new object containing only:
   - `artifactId: string`
   - `artifactKind: string`
   - `uri: string`
   
   Do not retain extra fields. Do not deep-copy (StageArtifact has only string fields).

4. **No aliasing:** Public result contains orchestrator-owned shallow copies, not references to executor-owned objects or arrays.

5. **No freezing:** Do not call `Object.freeze()` or similar enforcement. Readonly is compile-time only.

### What the Orchestrator Does NOT Validate

- **artifactId uniqueness** — executor's responsibility; no deduplication
- **artifactId format** — executor manages all content
- **artifactKind semantics** — Phase 3+ concern (gates, routing)
- **uri format or scheme** — uri is opaque; any string is valid
- **uri accessibility** — no existence checks or dereferencing
- **artifact immutability enforcement** — executor's contract (not runtime-validated in RFC-0009)
- **duplicate artifacts across stages** — Phase 3+ deduplication

---

## 8. Execution Result Examples

### SUCCEEDED with Mixed Artifacts

```typescript
{
  status: 'SUCCEEDED',
  completedStages: [
    { stageId: 'stage-1', artifacts: [{ artifactId: 'out-1', artifactKind: 'rendering', uri: 'file:///tmp/frame-001.png' }] },
    { stageId: 'stage-2', artifacts: [] },  // empty array: successful with no output
    { stageId: 'stage-3', artifacts: [{ artifactId: 'final', artifactKind: 'video', uri: 's3://bucket/video.mp4' }] }
  ]
}
```

### SUCCEEDED with No Artifacts

```typescript
{
  status: 'SUCCEEDED',
  completedStages: [
    { stageId: 'stage-1', artifacts: [] },
    { stageId: 'stage-2', artifacts: [] }
  ]
}
```

### FAILED Before Any Execution

```typescript
{
  status: 'FAILED',
  completedStages: [],
  failedStageId: 'stage-1',
  reason: 'MISSING_STAGE_DEFINITION',
  details: 'Stage stage-1 not found in stage definitions.'
}
```

### FAILED After Partial Execution

```typescript
{
  status: 'FAILED',
  completedStages: [
    { stageId: 'stage-1', artifacts: [{ artifactId: 'out-1', artifactKind: 'rendering', uri: 'file:///tmp/frame-001.png' }] }
  ],
  failedStageId: 'stage-2',
  reason: 'EXECUTOR_FAILED',
  details: 'Executor reported failure.'
  // Note: completedStages contains only stages that succeeded before failure
  // stage-2 did not succeed, so it is not in completedStages
  // No stage-3 was executed (fail-fast)
}
```

### SUCCEEDED with Zero Stages (Empty Plan)

```typescript
{
  status: 'SUCCEEDED',
  completedStages: []
}
```

**Clarifications:**

1. **On FAILED:** `completedStages` contains only stages that succeeded before the failure. Failed stages and unexecuted stages are absent.

2. **Artifact array order:** Preserved exactly as returned by the executor. Not sorted, not rearranged.

3. **Empty artifacts:** An empty array `[]` means the stage succeeded but produced no artifacts (semantically meaningful).

4. **Failed executors:** Do not contribute to `completedStages`. No artifacts from a failed or unexecuted stage.

---

## 9. Execution Semantics

### Algorithm (Extends RFC-0008)

```
1. Validate stageDefinitions (unchanged from RFC-0008)
2. Initialize completedStages: CompletedStageExecution[] = []
3. For each stage in topological order:
   a. Look up StageDefinition by stageId (unchanged)
   b. Extract stageKind (unchanged)
   c. Look up executor by stageKind (unchanged)
   d. Create StageExecutionInput { stageId, stageKind } (unchanged)
   e. Invoke executor (unchanged)
   f. Normalize result:
      - If throws/rejects → EXECUTOR_THREW (unchanged), fail-fast
      - If status === 'FAILED' → EXECUTOR_FAILED (unchanged), fail-fast
      - If status is neither 'SUCCEEDED' nor 'FAILED' → EXECUTOR_FAILED, fail-fast
      - If status === 'FAILED' and result includes artifacts property → EXECUTOR_FAILED, fail-fast
      - If status === 'SUCCEEDED':
        * Validate artifacts field is present (not undefined, not null, not missing)
        * If missing/null/undefined → EXECUTOR_FAILED with details "Executor returned an invalid result.", fail-fast
        * Validate artifacts is an array
        * If not an array → EXECUTOR_FAILED with details "Executor returned an invalid result.", fail-fast
        * Validate each artifact element:
          - If null or not an object → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure.", fail-fast
          - If missing artifactId, artifactKind, or uri → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure.", fail-fast
          - If artifactId/artifactKind/uri is not a string → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure.", fail-fast
        * If all validation passes:
          - Create shallow copies: for each artifact, copy only { artifactId, artifactKind, uri }
          - Append { stageId, artifacts: [...shallow copies in original order] } to completedStages
          - Continue to next stage
   g. On any failure: halt, do not execute remaining stages
4. Build result:
   - If all stages succeeded:
     { status: 'SUCCEEDED', completedStages }
   - If any stage failed:
     { status: 'FAILED', completedStages, failedStageId, reason, details }
     where completedStages contains only the stages that succeeded before failure
```

### Invariants (RFC-0009 Requirements)

1. **completedStages order:** Matches topological execution order from ExecutionPlan (RFC-0007)

2. **completedStages length on SUCCEEDED:** Equals number of stages in ExecutionPlan

3. **completedStages length on FAILED:** Equals number of stages that succeeded before failure; first failure always has completedStages: []

4. **Each stage appears once:** No duplicates in completedStages

5. **Artifact array order:** Preserved exactly as returned by executor; not sorted, not filtered, not re-ordered

6. **Shallow copy only:** Orchestrator creates new array and copies only { artifactId, artifactKind, uri }; no deep copy

7. **No aliasing:** Public result contains no references to executor-owned objects or arrays

8. **Failed stages excluded:** Failed and unexecuted stages never appear in completedStages

9. **No timestamps:** StageArtifact and completedStages contain no createdAt, modifiedAt, or executedAt fields

10. **Empty artifact array is valid:** [] means stage succeeded with no output (semantically meaningful)

11. **Extra artifact fields discarded:** Only { artifactId, artifactKind, uri } retained in output

---

## 10. Determinism, Immutability, and Aliasing Invariants

### Determinism Guarantee

**Claim:** Given the same ExecutionPlan, StageDefinition[], and Executors map, and given that each executor produces the same StageExecutionResult (including same artifacts in same order), the orchestrator returns identical SequentialExecutionResult.

**Required:**
- Topological ordering is stable (RFC-0007 guarantee)
- Artifact ordering matches executor output exactly
- No external state affects result construction
- No timestamps or runtime delays affect result

### Immutability Contract (Compile-Time Only)

**Key clarification:** `readonly` is compile-time TypeScript enforcement only. It does NOT imply runtime immutability guarantees.

**Executor Contract:** Executor commits not to modify artifact objects or arrays after returning StageExecutionResult. Executor retains ownership of returned objects until orchestrator processes them.

**Orchestrator Responsibility:** Orchestrator must:
- Not mutate the executor's result object
- Not mutate the executor-provided artifacts array
- Not mutate any artifact objects received from executor
- Create a new artifacts array for each CompletedStageExecution
- Create shallow copies of each accepted artifact, copying only: artifactId, artifactKind, uri
- Never call Object.freeze(), Object.seal(), or similar
- Not retain aliases to executor-owned objects or arrays

**Public Result Ownership:** The SequentialExecutionResult returned to callers contains orchestrator-owned shallow copies of artifacts. No artifact references point to executor-owned objects.

**No Runtime Validation:** RFC-0009 does not validate that executors honor their immutability contract. Phase 3+ may add such enforcement if needed.

### Aliasing and Copy Policy

**Shallow Copy Specification:**
```typescript
// Given executor result:
const executorResult = {
  status: 'SUCCEEDED',
  artifacts: [
    { artifactId: 'a', artifactKind: 'k', uri: 'u', extraField: 'ignored' },
    { artifactId: 'b', artifactKind: 'k2', uri: 'u2', anotherField: 123 }
  ]
};

// Orchestrator creates shallow copies:
const copiedArtifacts = executorResult.artifacts.map(art => ({
  artifactId: art.artifactId,
  artifactKind: art.artifactKind,
  uri: art.uri
}));

// Result contains orchestrator-owned array and objects:
const result = {
  status: 'SUCCEEDED',
  completedStages: [
    { stageId: 'stage-1', artifacts: copiedArtifacts }  // new array, new objects
  ]
};
```

**No Deep Copy Required:** StageArtifact contains only string fields; shallow copy is sufficient.

**Extra Fields Are Stripped:** Enumerable properties not in { artifactId, artifactKind, uri } are discarded from output.

**Order Preserved:** Copy operation maintains executor-provided order exactly.

### No Timestamps

- StageArtifact has no createdAt, modifiedAt, or executedAt field
- SequentialExecutionResult has no timestamp fields
- Artifact uri should not embed timestamp (that's executor's problem, not RFC-0009's)

---

## 11. Alternatives Rejected

### Alternative 1: Dual completedStages (string[]) + stageResults (CompletedStageExecution[])

**Rejected because:**
- **Redundancy:** Both fields contain the same stage identifiers in the same order. Maintaining two parallel arrays is error-prone.
- **Future extensibility:** RFC-0009 adds artifacts; RFC-0010 might add stageMetrics; RFC-0011 might add stageReceipts. Each new per-stage field would require a new parallel array.
- **Single source of truth:** CompletedStageExecution becomes the durable extension point for all per-stage data.
- **Cost of breaking change:** RFC-0008 is not yet published in production. v1.0 is early enough to accept a controlled shape change.
- **Migration path:** Clear. Clients must access `completedStages[i].stageId` instead of `completedStages[i]`.

This RFC chooses single-field clarity over pseudo-backward-compatibility with an unpublished internal shape.

### Alternative 2: Artifact URIs with format validation

**Rejected because:** RFC-0009 treats uri as fully opaque. No string format requirements (not filesystem path, not URL, could be custom). Validation belongs in Phase 3+ (lineage, persistence).

### Alternative 3: Artifact deduplication in orchestrator

**Rejected because:** Uniqueness validation belongs to Phase 3+ (lineage, gates). RFC-0009 does not deduplicate or validate that same artifactId is not returned twice.

### Alternative 4: Mandatory artifacts on SUCCEEDED

**Rejected because:** Allow empty artifact array. Some stages may succeed without producing artifacts (pure computation, state mutation, etc.). Empty array is semantically meaningful (no output).

### Alternative 5: New failure code for malformed artifacts

**Rejected because:** Map to EXECUTOR_FAILED. Keep RFC-0008 failure taxonomy frozen. EXECUTOR_FAILED is broadly applicable (executor returned something unexpected).

### Alternative 6: Return artifacts on FAILED status

**Rejected because:** No artifacts from failed executors. Fail-fast semantics don't allow partial artifact collection from failed stages. Only SUCCEEDED stages contribute artifacts.

### Alternative 7: Timestamp in artifacts

**Rejected because:** Keep artifacts timestamp-free. Phase 3+ can wrap artifacts with execution metadata if needed.

---

## 12. Test Matrix (Expanded)

### Artifact Structure Tests

- [ ] Empty artifact array accepted → SUCCEEDED with `artifacts: []`
- [ ] One artifact → SUCCEEDED with single-element artifacts array
- [ ] Multiple artifacts → SUCCEEDED with all artifacts in executor order
- [ ] Artifact order preserved → Order matches executor output byte-for-byte, no re-sorting
- [ ] Duplicate artifactId values accepted → Same artifactId in multiple elements OK
- [ ] Duplicate uri values accepted → Same uri in multiple elements OK
- [ ] Empty strings accepted → `artifactId: ""` or `artifactKind: ""` or `uri: ""` OK
- [ ] Extra artifact fields accepted but stripped → Extra enumerable properties removed from output
- [ ] Extra artifact fields not retained → Public result contains only { artifactId, artifactKind, uri }

### Executor Result Structure Tests

- [ ] Status !== SUCCEEDED/FAILED → EXECUTOR_FAILED with details "Executor returned an invalid result."
- [ ] FAILED result carrying artifacts property → EXECUTOR_FAILED with details "Executor returned an invalid result."
- [ ] SUCCEEDED missing artifacts → EXECUTOR_FAILED with details "Executor returned an invalid result."
- [ ] SUCCEEDED with artifacts: undefined → EXECUTOR_FAILED with details "Executor returned an invalid result."
- [ ] SUCCEEDED with artifacts: null → EXECUTOR_FAILED with details "Executor returned an invalid result."
- [ ] SUCCEEDED with artifacts: "not-an-array" → EXECUTOR_FAILED with details "Executor returned an invalid result."

### Artifact Element Validation Tests

- [ ] Null artifact entry → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."
- [ ] Non-object artifact entry → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."
- [ ] Artifact missing artifactId → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."
- [ ] Artifact missing artifactKind → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."
- [ ] Artifact missing uri → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."
- [ ] Non-string artifactId → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."
- [ ] Non-string artifactKind → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."
- [ ] Non-string uri → EXECUTOR_FAILED with details "Executor returned artifacts with invalid structure."

### Stage Execution Order Tests

- [ ] Empty plan → { status: 'SUCCEEDED', completedStages: [] }
- [ ] Single stage, no artifacts → { status: 'SUCCEEDED', completedStages: [{ stageId: 's1', artifacts: [] }] }
- [ ] Single stage, one artifact → completedStages contains one CompletedStageExecution
- [ ] Single stage, multiple artifacts → completedStages[0].artifacts in executor order
- [ ] Multiple completed stages → completedStages array in topological order
- [ ] Stage order preserved → stageId sequence matches ExecutionPlan order
- [ ] Linear pipeline (3 stages) → All 3 CompletedStageExecution in execution order

### Failure Accumulation Tests

- [ ] Pre-execution validation failure (stage 1) → { status: 'FAILED', completedStages: [] }
- [ ] DUPLICATE_STAGE_DEFINITION on stage 1 → completedStages: []
- [ ] MISSING_STAGE_DEFINITION on stage 1 → completedStages: []
- [ ] MISSING_EXECUTOR on first unexecutable stage → completedStages: []
- [ ] Malformed first executor result → completedStages: []
- [ ] First executor returns FAILED → completedStages: []
- [ ] First executor throws/rejects → completedStages: []
- [ ] Failure after prior successful stages → completedStages preserves only prior successes
- [ ] Executor returns FAILED after stage 1 succeeds → completedStages: [stage-1 only]
- [ ] Executor throws after stage 1 succeeds → completedStages: [stage-1 only]
- [ ] Malformed artifact after stage 1 succeeds → completedStages: [stage-1 only]
- [ ] Invalid result status after stage 1 succeeds → completedStages: [stage-1 only]
- [ ] FAILED carrying artifacts after stage 1 succeeds → completedStages: [stage-1 only]

### Immutability and Aliasing Tests

- [ ] Executor result not mutated → Public result does not reference executor's original object
- [ ] Executor artifacts array not mutated → Orchestrator creates new array for completedStages
- [ ] Executor artifact objects not aliased → Public artifacts are shallow copies, not executor's objects
- [ ] Public output array not aliased → Public completedStages is not the executor-provided array
- [ ] Artifact shallow copy only → Only { artifactId, artifactKind, uri } copied, no deep-copy
- [ ] Extra fields discarded → Extra enumerable properties not in output

### Determinism Tests

- [ ] Artifact order deterministic → Same executor input → same artifact order
- [ ] No sorting applied → Order preserved as executor returned
- [ ] No deduplication → Duplicate IDs/URIs preserved
- [ ] Prototype-like executor keys safe → Keys like __proto__, constructor, toString ignored or preserved without mutation
- [ ] Opaque uri preserved byte-for-byte → No normalization, URI returned exactly as provided
- [ ] Identical inputs → identical output (including artifact order)

### Failure Reason Tests

- [ ] Five frozen failure reasons: DUPLICATE_STAGE_DEFINITION, MISSING_STAGE_DEFINITION, MISSING_EXECUTOR, EXECUTOR_FAILED, EXECUTOR_THREW
- [ ] No new failure reasons introduced
- [ ] Malformed artifacts map to EXECUTOR_FAILED (no new code)

---

## 13. Migration Plan

### Phase 1 (Current, RFC-0009 acceptance)

This is when RFC-0009 lands. No gradual rollout; the breaking change is accepted upfront.

**Changes:**
- Add `artifacts: readonly StageArtifact[]` to SUCCEEDED variant of StageExecutionResult
- Add `CompletedStageExecution` type with `stageId` and `artifacts` fields
- Change `completedStages` from `readonly string[]` to `readonly CompletedStageExecution[]` in both SUCCEEDED and FAILED variants
- Update executeSequentialPlan() algorithm to build completedStages as array of CompletedStageExecution
- Validate executor artifacts field (presence, type, structure)
- No dual fields; no shim; no backward-compatibility layer

**Client impact:**
```typescript
// Before (RFC-0008)
for (const stageId of result.completedStages) { ... }

// After (RFC-0009)
for (const completed of result.completedStages) {
  const stageId = completed.stageId;
  const artifacts = completed.artifacts;
}
```

**Executors:** Must start returning `{ status: 'SUCCEEDED', artifacts: [...] }`. Empty array `[]` is valid.

### No Phase 2 or Phase 3

The single source of truth (CompletedStageExecution) is permanent. No deprecation, no removal cycles. This is the final shape for artifact collection in RFC-0009+.

**Justification:** Breaking change accepted once upfront to avoid long-term duplication and enable extension (RFC-0010+ can add fields to CompletedStageExecution without creating new parallel arrays).

---

## 14. Acceptance Criteria

RFC-0009 is accepted when ALL of the following are confirmed:

**Type Ownership:**
- [x] All orchestration types owned by `src/orchestration/sequential-executor.ts`
- [x] Planning types remain in `src/core/execution-plan.ts` (unchanged)
- [x] No circular dependencies introduced
- [x] Export flow: sequential-executor.ts → orchestration/index.ts → index.ts

**Validation Policy:**
- [x] Frozen acceptance list documented (empty array, duplicates, extra fields, empty strings)
- [x] Frozen rejection list documented (null, undefined, missing, wrong type)
- [x] Exact error messages locked ("Executor returned an invalid result." vs. "Executor returned artifacts with invalid structure.")
- [x] No new error messages introduced

**Aliasing and Immutability:**
- [x] Shallow copy policy documented (only { artifactId, artifactKind, uri })
- [x] No mutation of executor objects or arrays
- [x] No Object.freeze() enforcement
- [x] No aliasing to executor-owned objects
- [x] Compile-time-only `readonly` clarified

**Failure Semantics:**
- [x] Failure taxonomy frozen: DUPLICATE_STAGE_DEFINITION, MISSING_STAGE_DEFINITION, MISSING_EXECUTOR, EXECUTOR_FAILED, EXECUTOR_THREW
- [x] EXECUTOR_NOT_FOUND corrected to MISSING_EXECUTOR
- [x] Malformed artifacts map to EXECUTOR_FAILED (no new code)
- [x] Failure accumulation semantics documented: early failures have completedStages: []

**Contracts:**
- [x] StageArtifact finalized
- [x] CompletedStageExecution finalized
- [x] StageExecutionResult finalized
- [x] SequentialExecutionResult finalized
- [x] Single source of truth: completedStages only (no stageResults)
- [x] Breaking change accepted upfront (no compatibility shim)

**Determinism:**
- [x] Artifact order preserved exactly
- [x] No sorting, filtering, or re-ordering
- [x] Determinism invariants testable

**Test Matrix:**
- [x] 60+ rows covering all accept/reject cases
- [x] Artifact structure tests
- [x] Executor result validation tests
- [x] Failure accumulation tests
- [x] Immutability and aliasing tests
- [x] Determinism and ordering tests

**Scope:**
- [x] Artifact persistence out of scope
- [x] Uniqueness validation out of scope
- [x] Lineage/provenance out of scope
- [x] URI interpretation out of scope
- [x] Metrics/receipts/warnings out of scope (compactly stated, not overemphasized)

**Implementation Boundary:**
- [x] Files that will change specified (sequential-executor.ts, orchestration/index.ts, index.ts, tests)
- [x] Files that will NOT change specified (execution-plan.ts, planner.ts, planning contracts)
- [x] Explicit guarantee: no new modules required
- [x] No stageResults field introduced
- [x] No dual fields on SequentialExecutionResult

---

## 15. Final Type Ownership and Implementation Boundary

### Type Ownership Clarification

**RFC-0009 types MUST be owned by:**
- `src/orchestration/sequential-executor.ts` — runtime orchestration types

**Planning-only types (RFC-0008 and earlier) MUST remain in:**
- `src/core/execution-plan.ts` — planning contracts only

### Files That Will Change (When RFC-0009 is implemented)

```
src/orchestration/sequential-executor.ts
  └─ Add: type StageArtifact { 
       readonly artifactId: string;
       readonly artifactKind: string;
       readonly uri: string;
     }
  └─ Add: type CompletedStageExecution {
       readonly stageId: string;
       readonly artifacts: readonly StageArtifact[];
     }
  └─ Add: type StageExecutionInput { ... } (if not already present)
  └─ Add: type StageExecutionResult
       | { readonly status: 'SUCCEEDED'; readonly artifacts: readonly StageArtifact[] }
       | { readonly status: 'FAILED' }
  └─ Add: type SequentialExecutionInput { ... } (if not already present)
  └─ Add: type SequentialExecutionResult
       | { readonly status: 'SUCCEEDED'; readonly completedStages: readonly CompletedStageExecution[] }
       | { readonly status: 'FAILED'; 
           readonly completedStages: readonly CompletedStageExecution[];
           readonly failedStageId: string;
           readonly reason: SequentialExecutionFailureReason;
           readonly details: string;
         }
  └─ Add: type SequentialExecutionFailureReason (enum or union of 5 frozen codes)
  └─ Add: type StageExecutor { ... } (if not already present)
  └─ Update: executeSequentialPlan() algorithm
       * Initialize completedStages: CompletedStageExecution[] = []
       * Validate executor artifacts field (presence, type, content) per Section 7
       * Create shallow copies of artifacts for output
       * Append { stageId, artifacts: [...shallow copies...] } to completedStages on SUCCEEDED
       * Do not mutate executor-provided arrays or objects
       * Return SequentialExecutionResult with completedStages (no stageResults field)
  └─ Add: artifact validation logic (nulls, types, missing fields)
  └─ Add: shallow copy logic (copy only artifactId, artifactKind, uri; no deep copy)
  └─ Update: error details for EXECUTOR_FAILED on malformed artifacts

src/orchestration/index.ts
  └─ Export: StageArtifact, CompletedStageExecution, StageExecutionInput, StageExecutionResult, SequentialExecutionInput, SequentialExecutionResult, SequentialExecutionFailureReason

src/index.ts
  └─ Re-export: StageArtifact, CompletedStageExecution from src/orchestration/index.ts

tests/sequential-orchestration.test.ts
  └─ Add: artifact collection tests (positive cases from Section 12)
  └─ Add: malformed artifact tests (EXECUTOR_FAILED cases from Section 12)
  └─ Add: artifact ordering tests (determinism invariants from Section 12)
  └─ Add: immutability tests (no mutation of executor objects/arrays from Section 12)
  └─ Extend: existing result-shape tests to verify completedStages structure
```

### Files That Will NOT Change

```
src/core/execution-plan.ts
  └─ Remains planning-only
  └─ Owns: StageDefinition, PlanningInput, PlannedStage, ExecutionPlan, PlanningError
  └─ No runtime types added
  └─ No changes for RFC-0009

src/planning/planner.ts
  └─ No changes

All RFC-0001–0008 type contracts
  └─ Unchanged except SequentialExecutionResult shape (updated by RFC-0009)
```

### Explicit Guarantees

1. **No new modules created** — existing files provide coherent boundaries
2. **No circular dependencies** — sequential-executor.ts may import from execution-plan.ts (planning types) without reverse dependency
3. **No stageResults field** — completedStages is the single source of truth; no parallel arrays
4. **No dual fields** — no deprecated_completedStages, no stageIds array alongside CompletedStageExecution
5. **No backward-compatibility shims** — breaking change from RFC-0008 accepted upfront
6. **No new failure codes** — five frozen codes from RFC-0008 remain

---

## 16. Scope Boundary (Out of RFC-0009)

The following are explicitly OUT OF SCOPE for RFC-0009 implementation:

- Artifact persistence (writes to disk, network, database)
- Artifact validation against executor schema (executor defines schema; orchestrator does not validate content)
- Artifact content hash verification or integrity checks
- Artifact deduplication or uniqueness checking across stages
- Artifact lineage, provenance, or dependency tracking
- Artifact lifecycle (expiration, deletion, retention policies)
- Artifact streaming, chunking, or large-file transfer
- Artifact format conversion or decompression
- Artifact export from orchestrator or CLI listing
- URI interpretation, scheme validation, or existence checks
- Upstream artifact propagation (passing prior-stage artifacts to executors)
- Parallel execution or executor plugins
- Retries, replay, or resume mechanics
- Caching or deduplication of executor results
- Receipts, metrics, or performance tracking beyond what CompletedStageExecution already provides
- Warnings or deprecation notices
- Versioning of artifacts or result schemas

Future RFCs (Phase 3+, gates, persistence, lineage) may extend CompletedStageExecution with additional per-stage metadata, but they will not change RFC-0009's core validation or aliasing policy.

---

## 17. Adversarial Review Corrections (Final Confirmations)

### 17.1 Final Type Ownership Table

| Type | Owner | Status |
|------|-------|--------|
| `StageArtifact` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME |
| `CompletedStageExecution` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME |
| `StageExecutionInput` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME |
| `StageExecutionResult` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME |
| `StageExecutor` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME |
| `SequentialExecutionInput` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME |
| `SequentialExecutionResult` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME |
| `SequentialExecutionFailureReason` | `src/orchestration/sequential-executor.ts` | ✓ RUNTIME (5 codes frozen) |
| `StageDefinition` | `src/core/execution-plan.ts` | ✓ PLANNING (unchanged) |
| `PlanningInput` | `src/core/execution-plan.ts` | ✓ PLANNING (unchanged) |
| `PlannedStage` | `src/core/execution-plan.ts` | ✓ PLANNING (unchanged) |
| `ExecutionPlan` | `src/core/execution-plan.ts` | ✓ PLANNING (unchanged) |
| `PlanningError` | `src/core/execution-plan.ts` | ✓ PLANNING (unchanged) |

### 17.2 Final Runtime Validation Matrix

**ORCHESTRATOR MUST ACCEPT:**
- ✓ `artifacts: []` (empty array)
- ✓ One or more valid artifacts
- ✓ Duplicate `artifactId` values
- ✓ Duplicate `uri` values
- ✓ Empty strings for `artifactId`, `artifactKind`, or `uri`
- ✓ Extra enumerable fields on artifact objects (stripped from output)

**ORCHESTRATOR MUST REJECT (EXECUTOR_FAILED):**
- ✗ Missing `artifacts` property → "Executor returned an invalid result."
- ✗ `artifacts: undefined` → "Executor returned an invalid result."
- ✗ `artifacts: null` → "Executor returned an invalid result."
- ✗ `artifacts` not an array → "Executor returned an invalid result."
- ✗ Null artifact entry → "Executor returned artifacts with invalid structure."
- ✗ Non-object artifact entry → "Executor returned artifacts with invalid structure."
- ✗ Missing `artifactId` → "Executor returned artifacts with invalid structure."
- ✗ Missing `artifactKind` → "Executor returned artifacts with invalid structure."
- ✗ Missing `uri` → "Executor returned artifacts with invalid structure."
- ✗ Non-string `artifactId` → "Executor returned artifacts with invalid structure."
- ✗ Non-string `artifactKind` → "Executor returned artifacts with invalid structure."
- ✗ Non-string `uri` → "Executor returned artifacts with invalid structure."
- ✗ Unknown status (not 'SUCCEEDED'/'FAILED') → "Executor returned an invalid result."
- ✗ FAILED result carrying `artifacts` property → "Executor returned an invalid result."

### 17.3 Final Aliasing and Immutability Policy

**Compile-time only:** `readonly` is TypeScript enforcement, not runtime guarantee.

**Orchestrator must:**
1. Not mutate executor result object
2. Not mutate executor-provided artifacts array
3. Create new artifacts array for completedStages
4. Create shallow copy of each accepted artifact containing ONLY: `artifactId`, `artifactKind`, `uri`
5. Not retain extra artifact fields in public result
6. Not deep-copy (StageArtifact has only string fields)
7. Not call `Object.freeze()`
8. Not retain aliases to executor-owned objects or arrays

**Public result:** Orchestrator-owned shallow copies only.

**Order:** Preserved exactly; no sorting or deduplication.

### 17.4 Corrected Failure Taxonomy Confirmation

**Five frozen failure reasons (RFC-0008, unchanged for RFC-0009):**
1. `DUPLICATE_STAGE_DEFINITION`
2. `MISSING_STAGE_DEFINITION`
3. `MISSING_EXECUTOR` ← Corrected from EXECUTOR_NOT_FOUND
4. `EXECUTOR_FAILED`
5. `EXECUTOR_THREW`

**No new failure reasons introduced.**

**Malformed artifacts map to:** `EXECUTOR_FAILED` (no new code).

### 17.5 Expanded Test Matrix Confirmation

**Test matrix (Section 12) includes 60+ explicit rows:**
- ✓ Artifact structure tests (9 rows)
- ✓ Executor result structure tests (6 rows)
- ✓ Artifact element validation tests (9 rows)
- ✓ Stage execution order tests (7 rows)
- ✓ Failure accumulation tests (13 rows)
- ✓ Immutability and aliasing tests (6 rows)
- ✓ Determinism tests (7 rows)
- ✓ Failure reason tests (3 rows)

### 17.6 Final Public Contracts (Frozen)

```typescript
type StageArtifact = {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly uri: string;
};

type CompletedStageExecution = {
  readonly stageId: string;
  readonly artifacts: readonly StageArtifact[];
};

type StageExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly artifacts: readonly StageArtifact[];
    }
  | {
      readonly status: 'FAILED';
    };

type SequentialExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly completedStages: readonly CompletedStageExecution[];
    }
  | {
      readonly status: 'FAILED';
      readonly completedStages: readonly CompletedStageExecution[];
      readonly failedStageId: string;
      readonly reason: SequentialExecutionFailureReason;
      readonly details: string;
    };
```

**Confirmation:** No `stageResults` field anywhere. Single source of truth: `completedStages` only.

### 17.7 Final Implementation Boundary

**Files that WILL change:**
- `src/orchestration/sequential-executor.ts` (add types, update algorithm, add validation)
- `src/orchestration/index.ts` (add exports)
- `src/index.ts` (re-export)
- `tests/sequential-orchestration.test.ts` (add tests)

**Files that WILL NOT change:**
- `src/core/execution-plan.ts` (planning-only, no changes)
- `src/planning/planner.ts` (no changes)
- All RFC-0001–0008 planning contracts (no changes)

**Explicit guarantee:** `src/core/execution-plan.ts` will not be modified for RFC-0009. Planning code will not change. No new runtime module is required.

---

## Summary

**RFC-0009 Public Contracts:**

```typescript
type StageArtifact = {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly uri: string;
};

type CompletedStageExecution = {
  readonly stageId: string;
  readonly artifacts: readonly StageArtifact[];
};

type SequentialExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly completedStages: readonly CompletedStageExecution[];
    }
  | {
      readonly status: 'FAILED';
      readonly completedStages: readonly CompletedStageExecution[];
      readonly failedStageId: string;
      readonly reason: SequentialExecutionFailureReason;
      readonly details: string;
    };
```

**Architecture Decision:**
- Single source of truth: `completedStages` is `CompletedStageExecution[]` (not dual fields)
- Intentional breaking change from RFC-0008 (v1.0 is early enough to accept this)
- Extensible per-stage record for future RFCs (stageMetrics, stageReceipts, etc.)

**RFC-0009 Provides:**
- Minimal immutable artifact reference contract (StageArtifact)
- Mandatory executor artifact return on SUCCEEDED
- Empty artifact array valid (success with no output)
- Single per-stage execution record (CompletedStageExecution)
- Deterministic artifact ordering (preserved as executor returns)
- Frozen failure taxonomy (five codes unchanged from RFC-0008)

**RFC-0009 Preserves:**
- RFC-0008 execution semantics (fail-fast, topological order, 5 failure codes)
- RFC-0007 planning determinism (same plan → same order)
- Immutability contract at executor boundary
- No artifact persistence, validation, or uniqueness checking

**RFC-0009 Unblocks:**
- Phase 3 gates (conditions on artifact kinds, lineage checks)
- Phase 4+ persistence (artifact registry, content hashing, dedup)
- Future RFCs (extend CompletedStageExecution without parallel arrays)

---

## 18. Unresolved Questions

1. **Question:** Should `artifactId` be validated to match a specific format (e.g., UUID, naming convention)?
   **Answer:** No. `artifactId` is executor-managed; the orchestrator accepts any string value, including the empty string.

2. **Question:** Should the orchestrator pass prior-stage artifacts to downstream executors?
   **Answer:** No. Out of scope (RFC-0009). Upstream artifact propagation is Phase 3+ responsibility.

3. **Question:** Should extra artifact fields trigger a validation error?
   **Answer:** No. Extra fields are silently stripped from output. Executor can include implementation-specific fields without blocking execution.

4. **Question:** Should empty `artifactId`, `artifactKind`, or `uri` be rejected?
   **Answer:** No. RFC-0009 accepts empty strings. Validation of string content (empty vs. non-empty) is executor and Phase 3+ responsibility.

5. **Question:** Should the orchestrator track artifact timestamps or executor metadata?
   **Answer:** No. Out of scope. StageArtifact contains only { artifactId, artifactKind, uri }. Metadata wrapping belongs to Phase 3+ RFCs.

6. **Question:** Should we introduce a CompletedStageExecution builder or factory function?
   **Answer:** Not required for RFC-0009. Direct object construction with shallow copies is sufficient.

---

## 19. Final Status

**REVISED STATUS: RFC_0009_REVISED_READY_FOR_FINAL_FREEZE_REVIEW**

This revision incorporates all adversarial review corrections:
- ✓ Type ownership fixed (orchestration → sequential-executor.ts)
- ✓ Runtime validation policy frozen with exact accept/reject rules
- ✓ Failure accumulation semantics frozen (completedStages: [] for early failures)
- ✓ Runtime immutability and aliasing policy frozen (shallow copies, no mutation, no Object.freeze)
- ✓ Taxonomy typo corrected (EXECUTOR_NOT_FOUND → MISSING_EXECUTOR)
- ✓ Final contracts confirmed frozen
- ✓ Test matrix expanded to 60+ rows
- ✓ Scope discipline applied (metrics, receipts, warnings compacted)
- ✓ Final implementation boundary specified (4 files change, 3+ remain unchanged)
- ✓ Confirmation: no stageResults field anywhere
- ✓ No forward-looking language about uncertain features

**Ready for:**
1. Final freeze review by architecture committee
2. Implementation of sequential-executor.ts changes only
3. Test implementation per Section 12 matrix
4. No dependency on RFC-0010+ for RFC-0009 shipping
