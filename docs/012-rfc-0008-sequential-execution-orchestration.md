# RFC-0008: Sequential Execution Orchestration

**Status:** Draft — Minimal Architecture  
**Date:** 2026-07-19  
**Depends On:** RFC-0001–RFC-0007

---

## 1. Purpose

RFC-0008 defines minimal sequential execution orchestration:

- Receive ExecutionPlan from RFC-0007 Phase 2
- Resolve stageKind from StageDefinition[] for each stage
- Look up executors by stageKind
- Invoke stages sequentially in topological order
- Collect results deterministically
- Fail fast on first failure

---

## 2. Scope

RFC-0008 covers:

- Sequential stage invocation (no parallelism)
- Executor lookup by stageKind
- Exception normalization into result objects
- Fail-fast behavior
- Deterministic result ordering
- Input validation (missing definitions, missing executors)

---

## 3. Non-Goals

Deferred to Phase 4+:

- Parallel execution
- Retries, resume, replay
- Persistence or checkpoints
- Gates, conditional branching
- Upstream result propagation
- Plugins or dynamic loading
- Artifacts, scheduling, CLI

---

## 4. Contracts

### 4.1 Executor Input

```typescript
export type StageExecutionInput = {
  readonly stageId: string;
  readonly stageKind: string;
};
```

### 4.2 Executor Result

```typescript
export type StageExecutionResult =
  | { readonly status: "SUCCEEDED" }
  | { readonly status: "FAILED" };
```

### 4.3 Executor Function

```typescript
export type StageExecutor = (
  input: StageExecutionInput
) => Promise<StageExecutionResult>;
```

### 4.4 Orchestration Input

```typescript
export type SequentialExecutionInput = {
  readonly plan: ExecutionPlan;
  readonly stageDefinitions: readonly StageDefinition[];
  readonly executors: Readonly<Record<string, StageExecutor>>;
};
```

### 4.5 Orchestration Result

```typescript
export type SequentialExecutionResult =
  | {
      readonly status: "SUCCEEDED";
      readonly completedStages: readonly string[];
    }
  | {
      readonly status: "FAILED";
      readonly completedStages: readonly string[];
      readonly failedStageId: string;
      readonly reason:
        | "DUPLICATE_STAGE_DEFINITION"
        | "MISSING_STAGE_DEFINITION"
        | "MISSING_EXECUTOR"
        | "EXECUTOR_FAILED"
        | "EXECUTOR_THREW";
      readonly details: string;
    };
```

---

## 5. Execution Semantics

### 5.1 Algorithm

Before execution, validate stageDefinitions:
- Build lookup: stageId → StageDefinition
- If duplicate stageId found → return FAILED with DUPLICATE_STAGE_DEFINITION, failedStageId = duplicated stageId, completedStages = [], details = "Duplicate stage definition."

For each stage in ExecutionPlan (topological order):

1. Look up StageDefinition by stageId
   - If missing → fail with MISSING_STAGE_DEFINITION, stop
2. Extract stageKind from definition
3. Look up executor by stageKind
   - If missing → fail with MISSING_EXECUTOR, stop
4. Create StageExecutionInput { stageId, stageKind }
5. Invoke executor:
   - If throws or rejects → fail with EXECUTOR_THREW, stop
   - If returns non-result value → fail with EXECUTOR_FAILED, stop
   - If returns { status: "FAILED" } → fail with EXECUTOR_FAILED, stop
   - If returns { status: "SUCCEEDED" } → add stageId to completedStages, continue

Return result:
- If all stages succeeded: { status: "SUCCEEDED", completedStages: [...] }
- If any failed: { status: "FAILED", completedStages: [...], failedStageId, reason, details }

### 5.2 Invariants

- completedStages contains only stageIds of stages that succeeded
- failedStageId identifies the stage that caused orchestration to fail (not in completedStages)
- Remaining stages after first failure are never invoked (fail-fast)
- Executor registry entries not referenced by the plan are ignored (not an error)
- No upstream results passed to executors
- No executor output collected in result
- No timestamps in result

---

## 6. Failure Model

| Reason | Trigger | Details |
|--------|---------|---------|
| DUPLICATE_STAGE_DEFINITION | stageDefinitions contains duplicate stageId | "Duplicate stage definition." |
| MISSING_STAGE_DEFINITION | Plan references stageId not in StageDefinition[] | Orchestrator-provided |
| MISSING_EXECUTOR | No executor registered for resolved stageKind | Orchestrator-provided |
| EXECUTOR_FAILED | executor() returned { status: "FAILED" } or invalid result | "Executor reported failure." or "Executor returned an invalid result." |
| EXECUTOR_THREW | executor() threw or rejected (any value) | "Executor threw or rejected." |

---

## 7. Determinism

The orchestrator guarantees deterministic execution:

- Deterministic plan traversal (topological order, same input → same traversal)
- Deterministic invocation order (same order each time)
- Deterministic completedStages ordering (topological)
- Deterministic failure categorization (same observable executor outcome → same failure reason)
- Stable orchestrator-controlled details strings (no variable external state in messages)

Wording: Given the same inputs and the same observable executor outcomes, the orchestrator returns the same canonical result.

Note: Executor behavior itself is not guaranteed deterministic by RFC-0008. The orchestrator's result is deterministic if executor results are consistent.

---

## 8. Public API

```typescript
export async function executeSequentialPlan(
  input: SequentialExecutionInput
): Promise<SequentialExecutionResult>;
```

Single entry point. No enrichment, caching, or state management.

---

## 9. Acceptance Criteria

- [ ] Detects DUPLICATE_STAGE_DEFINITION before any executor invocation; returns FAILED with completedStages = []
- [ ] Resolves stageKind for each stage via StageDefinition lookup
- [ ] Detects MISSING_STAGE_DEFINITION when plan references undefined stageId
- [ ] Detects MISSING_EXECUTOR when no executor for stageKind
- [ ] Invokes executors in topological order
- [ ] Passes StageExecutionInput { stageId, stageKind } to executor (no reason field)
- [ ] Normalizes thrown/rejected values as EXECUTOR_THREW (any value type)
- [ ] Normalizes { status: "FAILED" } as EXECUTOR_FAILED with details "Executor reported failure."
- [ ] Normalizes malformed results as EXECUTOR_FAILED with details "Executor returned an invalid result."
- [ ] Stops after first failure (fail-fast)
- [ ] Returns SUCCEEDED with completedStages (all stages) when all stages succeed
- [ ] Returns FAILED with failedStageId, reason (one of 5 codes), details; completedStages contains only successful stages before failure
- [ ] completedStages ordering matches topological order of successful stages
- [ ] Failure categorization is deterministic (same observable outcome → same reason code)
- [ ] Details strings are stable and orchestrator-controlled
- [ ] No mutation of input objects
- [ ] No timestamps, gates, payload, or upstream propagation in result

---

## 10. Test Plan

**Positive:**
- Single stage execution (executor succeeds)
- Linear pipeline (all stages succeed)
- Diamond DAG (multiple upstreams, all succeed)
- Deterministic invocation (same inputs → same canonical result)

**Validation failures (before executor invocation):**
- DUPLICATE_STAGE_DEFINITION: duplicate stageIds in definitions → completedStages = []
- MISSING_STAGE_DEFINITION: plan references undefined stageId

**Runtime failures (during execution):**
- MISSING_EXECUTOR: stageKind has no executor
- EXECUTOR_FAILED: executor returns { status: "FAILED" }
- EXECUTOR_FAILED: executor returns non-result value
- EXECUTOR_THREW: executor throws (Error, string, null, undefined, object)
- EXECUTOR_THREW: Promise rejection (any value)
- Fail-fast: stops after first failure, remaining stages not executed

**Edge cases:**
- Empty ExecutionPlan (0 stages) → status = "SUCCEEDED"
- Single stage (no upstreams) → executes normally
- Unused executor registry entries → ignored (not an error)

---

## 11. File Layout

```
src/
├── orchestration/
│   ├── sequential-executor.ts   (executeSequentialPlan + types)
│   └── index.ts                 (exports)
└── tests/
    └── sequential-orchestration.test.ts
```

Estimated: ~150 lines code, ~350 lines tests.

---

## 12. Exit Gate

Proceed to implementation when:

- [ ] StageExecutionInput (stageId, stageKind) frozen
- [ ] StageExecutionResult (SUCCEEDED | FAILED) frozen; executor provides no reason text
- [ ] SequentialExecutionInput (plan, definitions, executors) frozen
- [ ] SequentialExecutionResult (status, completedStages, failedStageId, reason, details) frozen
- [ ] Failure taxonomy (5 codes) locked: DUPLICATE_STAGE_DEFINITION, MISSING_STAGE_DEFINITION, MISSING_EXECUTOR, EXECUTOR_FAILED, EXECUTOR_THREW
- [ ] Duplicate stage definitions detected before any executor invocation
- [ ] All thrown/rejected values normalized identically to EXECUTOR_THREW
- [ ] Malformed results normalized to EXECUTOR_FAILED
- [ ] Details strings are stable and orchestrator-controlled
- [ ] No upstream result propagation
- [ ] No payload, output, data, gates, or timestamps in results
- [ ] Fail-fast behavior locked
- [ ] Determinism contract testable
- [ ] No RFC-0007 contract modifications
- [ ] Single public function: executeSequentialPlan()

---

## Architecture Note

This orchestrator performs inline executor lookup:
- Receives ExecutionPlan (stageId + upstreams from RFC-0007)
- Receives StageDefinition[] (external metadata)
- For each stage: stageId → definition → stageKind → executor → invoke

No intermediate artifacts (ExecutionContext), no separate enrichment phase, no framework layers.

---

**END OF RFC-0008 DRAFT**
