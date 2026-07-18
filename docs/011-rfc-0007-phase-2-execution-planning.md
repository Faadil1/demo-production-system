# RFC-0007 Phase 2 (v2) — Deterministic Execution Planning

**Status:** Draft — Redesigned for Architectural Review  
**Date:** 2026-07-18  
**RFC Reference:** [docs/009-artifact-resolution-and-orchestration.md](009-artifact-resolution-and-orchestration.md)  
**Depends On:** RFC-0001–RFC-0006, RFC-0007 Phase 1

---

## 1. Purpose

Phase 2 defines a minimal **pure planning layer** that validates a pipeline dependency graph, detects cycles, expands transitive dependencies, and produces a deterministic, topologically-sorted execution plan.

**Phase 2 is planning only. Stage execution, runtime state, gates, and lineage are Phase 3+ responsibilities.**

---

## 2. Scope (Minimal)

Phase 2 covers ONLY:

- Minimal stage definition (stageId + stageKind + dependsOn)
- Graph validation (cycles, missing dependencies)
- Deterministic topological ordering
- Transitive dependency expansion
- ExecutionPlan output

**Everything else is out of scope.**

---

## 3. Non-Goals (Explicit Deferral)

**Deferred to Phase 3+:**
- Stage execution and invocation
- Runtime state tracking (executing, blocked, passed, failed)
- Gate evaluation and aggregation
- Artifact resolution (Phase 1 calls)
- Lineage emission
- Timestamps (eliminated from canonical contracts)
- Artifact preflight validation
- Dry-run semantics (trivial consequence of pure planning)
- CLI implementation
- Parallel execution, replay, plugins, rendering logic

---

## 4. Minimal Terminology

- **Pipeline:** A DAG of stages with explicit dependencies.
- **StageId:** Unique stable identifier for a stage.
- **Dependency:** A directed edge A → B ("B depends on A").
- **Transitive Dependency:** Implicit path through intermediate stages (auto-expanded).
- **ExecutionPlan:** Topologically-sorted list of stages with upstream dependencies.
- **Cycle:** Circular dependency (A → B → A). Rejected at validation.

---

## 5. Minimal Stage Definition

```typescript
export type StageDefinition = {
  readonly stageId: string;
  readonly stageKind: string;
  readonly dependsOn: readonly string[];
};
```

**Why `stageKind` is included:**

The planner must not infer engine identity from `stageId` alone. `stageKind` is a routing category that signals *what type of work* a stage performs (e.g., "render", "encode", "test") without defining *how* that work executes or *when* it completes. This allows the planning contract to remain stable and independent of runtime binding decisions. Runtime handlers can dispatch stages to the appropriate executor based on `stageKind`, but the planner treats it as opaque metadata for routing only.

**What is NOT included:**

No version, no metadata beyond `stageKind`, no required fields, no artifact kinds, no gate policy, no runtime fields. Those belong to Phase 3+.

### Invariants

- **Acyclic:** No cycles allowed. Detected and rejected.
- **Valid References:** All upstream stageIds must exist in stageDefinitions.
- **No Self-Loops:** A stage cannot depend on itself.

---

## 6. Execution Plan Input

```typescript
export type PlanningInput = {
  readonly stageDefinitions: readonly StageDefinition[];
  readonly requestedStages: readonly string[];
};
```

No timestamps. No configuration. No environment. Just graph + request.

### RequestedStages Semantics

- `requestedStages` behaves as a **semantic set** for planning purposes.
- Duplicate values in `requestedStages` are **accepted and deterministically normalized**.
- Permutations and duplicates produce identical canonical `ExecutionPlan` output.
- **No error is raised for duplicate requestedStages.** They are normalized implicitly.
- The four-code `PlanningError` taxonomy does **not** include a duplicate-requestedStages code.

---

## 7. Execution Plan Output

```typescript
export type ExecutionPlan = {
  readonly stages: readonly PlannedStage[];
};

export type PlannedStage = {
  readonly stageId: string;
  readonly upstreams: readonly string[]; // resolved dependencies
};
```

Stages array is in topologically-sorted order. That's it.

---

## 8. Planning Algorithm

```
1. Validate
   - Check for duplicate stageIds in stageDefinitions → DUPLICATE_STAGE_ID
   - Check all requestedStages exist in stageDefinitions → UNKNOWN_REQUESTED_STAGE
   - Check all dependsOn references exist → UNKNOWN_STAGE_DEPENDENCY

2. Detect Cycles
   - Run DFS on entire StageDefinition graph
   - Reject on back edge anywhere in graph → DEPENDENCY_CYCLE

3. Normalize RequestedStages
   - De-duplicate requestedStages deterministically (semantic set)
   - Order does not affect output

4. Expand Transitive Dependencies
   - For each stage in normalized requestedStages, collect all upstreams recursively
   - De-duplicate using set

5. Topological Sort
   - Use Kahn's algorithm or DFS post-order
   - Tie-breaker: lexical stageId (deterministic)

6. Build Plan
   - For each sorted stage, compute upstreams from graph
   - Return ExecutionPlan
```

---

## 9. Determinism Guarantee

Pure planning is deterministic because:
- No timestamps (eliminated).
- No environment inspection (no process.env, no fs queries).
- Lexical tie-breaker for unrelated stages.
- Stable topological sort.
- Requestedstages normalized as semantic set (duplicates and permutations ignored).

**Test:** `createExecutionPlan(input)` with identical graph and semantically identical requestedStages → identical plans (byte-equal after serialization).

**Permutation invariance:**
- Reordering `stageDefinitions` → identical plan
- Permuting `dependsOn` arrays → identical plan
- Duplicating or reordering `requestedStages` → identical plan

---

## 10. Failure Taxonomy (Planning-Only)

Exactly four failure modes (frozen):

| Code | Trigger | Note |
|---|---|---|
| UNKNOWN_REQUESTED_STAGE | requestedStages includes nonexistent stageId | Duplicate requestedStages are NOT an error |
| UNKNOWN_STAGE_DEPENDENCY | Any dependsOn references nonexistent stageId | — |
| DEPENDENCY_CYCLE | Cycle detected anywhere in entire graph | Global validation, not limited to requestedStages closure |
| DUPLICATE_STAGE_ID | Two stages with same stageId in stageDefinitions | Applies to stageDefinitions only, not requestedStages |

```typescript
export type PlanningError = {
  readonly reason: 
    | "UNKNOWN_REQUESTED_STAGE"
    | "UNKNOWN_STAGE_DEPENDENCY"
    | "DEPENDENCY_CYCLE"
    | "DUPLICATE_STAGE_ID";
  readonly details: string;
};
```

**No fifth code.** Duplicate values in `requestedStages` are accepted and normalized deterministically.

---

## 11. Public API

Phase 2 exposes one entry point:

```typescript
export function createExecutionPlan(input: PlanningInput): ExecutionPlan | PlanningError;
```

**Rationale for single function:**

`createExecutionPlan()` is the only Phase 2 function because Phase 2 is a planning layer, not a validation framework. The planner validates input and produces a plan deterministically; if a plan is created by `createExecutionPlan()`, it is guaranteed valid. There is no independent validation need in Phase 2.

If Phase 3+ requires independent plan validation (e.g., for deserialized or imported plans), that is a Phase 3+ concern and will be addressed in the orchestration RFC.

**Future possibilities (Phase 3+):**

A future orchestration RFC may introduce additional entry points for execution, inspection, or validation. This RFC makes no claims about their names or signatures.

---

## 12. File Layout

```
src/
├── core/
│   └── execution-plan.ts    (types only)
├── planning/
│   └── planner.ts           (createExecutionPlan)
└── tests/
    └── planner.test.ts      (planning tests)
```

Entire Phase 2 footprint: ~200 lines of code + ~400 lines of tests.

---

## 13. Acceptance Criteria

Phase 2 implementation is done when:

- [ ] `createExecutionPlan()` validates input and rejects invalid graphs
- [ ] Detects duplicate stageIds → DUPLICATE_STAGE_ID
- [ ] Detects unknown requested stages → UNKNOWN_REQUESTED_STAGE
- [ ] Detects unknown stage dependencies → UNKNOWN_STAGE_DEPENDENCY
- [ ] Detects cycles anywhere in graph → DEPENDENCY_CYCLE
- [ ] Accepts and normalizes duplicate requestedStages (no error raised)
- [ ] Expands transitive dependencies
- [ ] Produces topologically-sorted stages
- [ ] Applies lexical tie-breaker for deterministic ordering
- [ ] Identical or semantically equivalent inputs produce identical plans (byte-equal after serialization)
- [ ] Permutations of stageDefinitions, dependsOn, and requestedStages produce identical plans
- [ ] All errors map to exactly four reason codes (no fifth code for duplicate requestedStages)

---

## 14. Test Plan

**Positive:**
- Single stage
- Two stages (demo → story)
- Three stages (demo → story → render)
- Subset (request story + render, auto-include demo)
- Determinism (identical inputs → identical plans)
- Tie-breaker (lexical ordering)

**RequestedStages Normalization:**
- Duplicate requestedStages (`["a", "a", "b", "a"]`) produce same plan as (`["a", "b"]`)
- Permuted requestedStages (`["b", "a"]` vs `["a", "b"]`) produce identical plans
- Disconnected components accepted and ignored if not requested

**Adversarial:**
- Reject duplicate stageIds
- Reject unknown requested stage
- Reject unknown dependency
- Reject cycle anywhere in graph (not just requested closure)
- Reject self-loop
- Reject diamond cycle with added back-edge
- Accept diamond DAG (A → {B,C}, B → D, C → D)
- Accept disconnected acyclic components
- De-duplicate transitive dependencies

---

## 15. Implementation (Single Phase)

**Phase 2: Complete Planner**
- Define types
- Implement `createExecutionPlan()`
- Cycle detection
- Transitive expansion
- Topological sort
- Tests

That's one phase. Planning is small.

---

## 16. Explicit Deferral to Phase 3+

**Out of Phase 2:**
- Orchestration Executor (invoke stages)
- Runtime State (executing, passed, failed, blocked)
- Gate Evaluation (pass/conditional/fail)
- Artifact Resolution (Phase 1 calls)
- Lineage Tracking (edges)
- Timestamps (eliminated)
- CLI (orchestrate-demo)
- Parallel Execution
- Renderer Adapters
- Dry-Run Semantics (trivial in Phase 3)
- Replay/Resume
- Plugins

---

## 17. Exit Gate

Proceed when:

- [ ] Architecture review approves planning-only scope (no runtime behavior, no independent validation)
- [ ] No contradiction with Phase 1 or RFCs 0001–0006
- [ ] StageDefinition contract frozen (3 fields: stageId, stageKind, dependsOn)
- [ ] ExecutionPlan contract frozen (stageId, upstreams)
- [ ] Failure taxonomy frozen (exactly 4 reason codes; no duplicate-requestedStages code)
- [ ] RequestedStages normalization locked (duplicates and permutations produce identical plans)
- [ ] Cycle detection is global (entire graph validated, not just requestedStages closure)
- [ ] Tie-breaker frozen (lexical stageId)
- [ ] Public API surface locked (single function: createExecutionPlan)
- [ ] Phase 3+ responsibilities explicitly acknowledged (orchestration, runtime state, gates, artifact resolution, lineage)

---

**END OF RFC-0007 PHASE 2 v2 DRAFT**
