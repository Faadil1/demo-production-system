# RFC-0010: Stage Artifact Input Bindings

## 1. Status

Frozen.

This RFC defines stage artifact input bindings for sequential orchestration. It is normative for how callers request that artifacts emitted by completed upstream stages become visible to later stages.

## 2. Context

The orchestration model already separates stage topology, stage definitions, executors, execution failure reporting, and artifact capture. ExecutionPlan owns topology: stages, dependencies, and plan order remain the authority for what may run and when. StageDefinition remains the authority for declared stage behavior. RFC-0009 defines artifact capture from executor results.

RFC-0010 adds a caller-provided runtime orchestration input that controls artifact visibility between stages without changing topology. ArtifactInputBindings owns artifact visibility. A binding does not alter the dependency graph and cannot make a source stage run before a target stage. It only says that, when a target stage is invoked, artifacts from a valid completed upstream source should be provided to that target.

## 3. Problem Statement

Sequential orchestration needs a deterministic way to provide artifacts from earlier stages to later stages. Without an explicit binding contract, artifact visibility is either implicit, overly broad, or dependent on executor-specific conventions.

The system must support these properties:

1. Callers can select which upstream stage artifacts are visible to each target stage.
2. Bindings cannot create dependencies or alter ExecutionPlan topology.
3. Validation is fully eager before any executor invocation.
4. Hostile or mutating caller input cannot affect execution after validation and normalization.
5. Runtime providedArtifacts semantics are deterministic and compatible with RFC-0009 artifact capture.

## 4. Decision

Add optional ArtifactInputBindings to SequentialExecutionInput. Bindings are runtime orchestration input. Each binding references sourceStageId only. For each target stage key, the value is the list of source stages whose emitted artifacts are visible to that target.

A target receives every artifact from each bound source. The caller cannot select individual artifacts in RFC-0010. Artifact order is plan source order, then RFC-0009 captured order within each source.

Any transitive upstream ancestor of a target is a valid source. A non-ancestor is invalid even if it appears earlier in plan order. The binding relationship does not create a dependency and does not modify ExecutionPlan.

Input is copied into a detached normalized structure during preflight. Caller input is never read again after normalization.

## 5. Terminology

Target stage: the stage receiving providedArtifacts.

Source stage: the completed upstream stage whose captured artifacts are made visible to a target stage.

Bound source: a sourceStageId listed under a target stage in ArtifactInputBindings.

Transitive upstream ancestor: a stage that can reach the target stage by following ExecutionPlan dependency edges toward the target.

Normalized bindings: the detached internal representation produced during preflight validation.

## 6. Public Contracts

```ts
export type ArtifactInputBinding = {
  readonly sourceStageId: string;
};

export type ArtifactInputBindings = Readonly<
  Record<string, readonly ArtifactInputBinding[]>
>;

export type SequentialExecutionInput = {
  readonly plan: ExecutionPlan;
  readonly stageDefinitions: readonly StageDefinition[];
  readonly executors: Readonly<Record<string, StageExecutor>>;
  readonly artifactInputBindings?: ArtifactInputBindings;
};

export type StageExecutionInput = {
  readonly stageId: string;
  readonly stageKind: string;
  readonly providedArtifacts?: readonly StageArtifact[];
};

export type SequentialExecutionFailureReason =
  | 'DUPLICATE_STAGE_DEFINITION'
  | 'MISSING_STAGE_DEFINITION'
  | 'MISSING_EXECUTOR'
  | 'EXECUTOR_FAILED'
  | 'EXECUTOR_THREW'
  | 'INVALID_ARTIFACT_BINDINGS';
```

ExecutionPlan and StageDefinition remain unchanged. RFC-0009 remains unchanged.

## 7. Canonical Orchestration Input

artifactInputBindings is part of SequentialExecutionInput and is interpreted only by the orchestrator. It is not passed through to executors. Executors receive only StageExecutionInput.

The internal representation is:

```ts
type NormalizedArtifactInputBindings = readonly {
  readonly targetStageId: string;
  readonly sourceStageIds: readonly string[];
}[];
```

Normalization produces this structure before any executor invocation. It contains only string target identifiers and string source identifiers that have already passed validation. It does not retain arrays, objects, property descriptors, prototypes, accessors, or references from caller input.

## 8. Binding Validity Rules

A binding set is valid only when all rules below hold:

1. Every target key names a stage in the ExecutionPlan.
2. Every target key is obtained from own enumerable string properties of artifactInputBindings.
3. Inherited properties are ignored.
4. Symbol keys are rejected explicitly.
5. Numeric keys are coerced to strings and validated as stage IDs.
6. Every target value is an array.
7. Every binding entry is an object with sourceStageId readable as a string.
8. Every sourceStageId names a stage in the ExecutionPlan.
9. Every sourceStageId is a transitive upstream ancestor of the target stage.
10. Duplicate sourceStageId values for the same target are invalid.
11. A target with an empty source list is valid and equivalent to having bound sources that emit no artifacts for invocation shape.

Bindings cannot create dependencies. A binding from A to B is valid only if A is already upstream of B in ExecutionPlan topology.

## 9. Safe Inspection and Normalization

Preflight must treat artifactInputBindings as hostile input. It must inspect own enumerable string target keys and ignore inherited properties. It must reject symbol keys explicitly, including non-enumerable symbols. It must guard Reflect.ownKeys, Object.keys, property reads, array reads, and sourceStageId reads because each operation can throw on hostile objects or proxies.

The orchestrator must not rely on prototypes. Tests for **proto** must use Object.defineProperty, Object.create(null), or JSON.parse. Tests must never claim that { "**proto**": value } reliably creates an ordinary own property.

Normalization copies values into detached arrays and records. Mutating the original artifactInputBindings object, any target array, or any binding object after normalization must have no effect. TypeScript readonly is compile-time only; it is not a runtime immutability boundary. Object.freeze is not required.

## 10. Preflight Validation Algorithm

Preflight validation runs after the ExecutionPlan, StageDefinition, and executor preflight checks needed to know the valid stage IDs and topology, and before invoking any executor.

The algorithm is:

1. If artifactInputBindings is absent, produce an empty NormalizedArtifactInputBindings value.
2. Safely call Reflect.ownKeys on artifactInputBindings. If this throws, fail preflight with INVALID_ARTIFACT_BINDINGS.
3. If any own key is a symbol, fail preflight with INVALID_ARTIFACT_BINDINGS.
4. Safely call Object.keys on artifactInputBindings. If this throws, fail preflight with INVALID_ARTIFACT_BINDINGS.
5. For each enumerable string target key from Object.keys, coerce the key to the targetStageId string already returned by Object.keys.
6. Validate that targetStageId exists in the ExecutionPlan. If not, fail preflight with INVALID_ARTIFACT_BINDINGS.
7. Safely read artifactInputBindings[targetStageId]. If this throws, fail preflight with INVALID_ARTIFACT_BINDINGS.
8. Validate that the target value is an array. If not, fail preflight with INVALID_ARTIFACT_BINDINGS.
9. Safely read the array length and each array element. If any read throws, fail preflight with INVALID_ARTIFACT_BINDINGS.
10. For each binding entry, safely read sourceStageId. If the read throws or the value is not a string, fail preflight with INVALID_ARTIFACT_BINDINGS.
11. Validate that sourceStageId exists in the ExecutionPlan. If not, fail preflight with INVALID_ARTIFACT_BINDINGS.
12. Validate that sourceStageId is a transitive upstream ancestor of targetStageId. If not, fail preflight with INVALID_ARTIFACT_BINDINGS.
13. Detect duplicate sourceStageId values within the same target. If any duplicate exists, fail preflight with INVALID_ARTIFACT_BINDINGS.
14. Copy each valid sourceStageId into a detached sourceStageIds array for that target.
15. Normalize targets and sources by ExecutionPlan order.

Validation is fully eager. No executor may be invoked if any binding is invalid.

## 11. Runtime Resolution Algorithm

When invoking a target stage, the orchestrator looks up the target in NormalizedArtifactInputBindings. It must not read caller artifactInputBindings again.

If the target has no normalized binding entry, StageExecutionInput omits providedArtifacts.

If the target has a normalized binding entry, the orchestrator resolves each sourceStageId in normalized source order. For each source, the orchestrator requires that the source has completed and has an RFC-0009 artifact capture result. If a bound upstream source is missing at runtime, the current target fails with EXECUTOR_FAILED.

The orchestrator then concatenates detached shallow copies of each source artifact in source order. Within a source, artifacts retain RFC-0009 captured order. The resulting array is assigned to providedArtifacts for the target invocation.

Malformed executor results still fail under RFC-0009 result validation and use EXECUTOR_FAILED. Executor throws use EXECUTOR_THREW.

## 12. Deterministic Ordering

Targets normalize by ExecutionPlan order, independent of caller property order. Sources normalize by ExecutionPlan order, independent of the order in each caller-provided target array.

providedArtifacts order is:

1. Bound source order by ExecutionPlan order.
2. Artifact order within each source by RFC-0009 captured order.

This ordering is deterministic for a fixed ExecutionPlan and fixed captured artifact sequence.

## 13. providedArtifacts Semantics

providedArtifacts is absent when no sources are bound for the target.

providedArtifacts is present as [] when sources are bound but emitted no artifacts.

providedArtifacts contains every artifact from each bound source. RFC-0010 does not filter by artifact name, kind, media type, or metadata.

providedArtifacts uses detached shallow copies. The array passed to the executor is detached from orchestrator storage and from caller input. Each StageArtifact object is shallow-copied so executor mutation of the received object does not mutate the stored captured artifact object. Nested values are not deeply copied by RFC-0010.

## 14. Failure Semantics

Add INVALID_ARTIFACT_BINDINGS to SequentialExecutionFailureReason. RFC-0008 had five failure reasons; RFC-0010 extends the union to six.

Preflight binding errors use INVALID_ARTIFACT_BINDINGS. This includes invalid target IDs, invalid source IDs, non-ancestor sources, duplicate source bindings, unsafe input inspection failures, symbol keys, unreadable values, and malformed binding entries.

Malformed executor results use EXECUTOR_FAILED.

Executor throws use EXECUTOR_THREW.

Missing completed upstream source at runtime uses EXECUTOR_FAILED for the current target.

## 15. Immutability and Aliasing

Readonly types describe compile-time intent only. They do not prevent runtime mutation and do not make hostile input safe.

The orchestrator must detach normalized binding data from caller input. After normalization, mutations to artifactInputBindings, target arrays, binding objects, prototypes, or accessors must not affect execution.

The orchestrator must also detach providedArtifacts from internal artifact storage using shallow copies. Object.freeze is not required for normalized bindings, stored artifacts, or provided artifacts.

## 16. Backward Compatibility

artifactInputBindings is optional. Existing callers that omit it continue to receive the same execution behavior except for the expanded failure reason union type.

SequentialExecutionFailureReason was originally defined by RFC-0008 with five
reasons. RFC-0010 intentionally extends that union with
INVALID_ARTIFACT_BINDINGS. The resulting public union contains six reasons.

Existing executors remain compatible because providedArtifacts is optional. Targets without bound sources receive no providedArtifacts property.

ExecutionPlan and StageDefinition remain unchanged. RFC-0009 artifact capture remains the source of stored artifacts and captured ordering.

## 17. Interaction with RFC-0007, RFC-0008, and RFC-0009

RFC-0007 defines artifact resolution and execution planning concerns that lead to explicit topology. RFC-0010 does not move topology ownership out of ExecutionPlan and does not add artifact input edges to planning.

RFC-0008 defines sequential execution orchestration and its failure reason union. RFC-0010 extends that union with INVALID_ARTIFACT_BINDINGS and requires eager preflight before any executor invocation.

RFC-0009 defines execution artifact capture from executor results. RFC-0010 consumes those captured artifacts for later StageExecutionInput.providedArtifacts, preserving captured order within each source. RFC-0009 remains unchanged.

## 18. Rejected Alternatives

Implicitly provide all upstream artifacts: rejected because it makes visibility broad by default and hides orchestration intent.

Allow bindings to create dependencies: rejected because ExecutionPlan owns topology and must remain the single source of dependency truth.

Reference individual artifacts in bindings: rejected because RFC-0010 binds source stages only. Fine-grained artifact selection can be considered separately.

Honor caller source array order: rejected because deterministic orchestration should derive ordering from ExecutionPlan, not input object or array construction details.

Deep-copy provided artifacts: rejected because RFC-0010 requires detached shallow copies only. Deep copying would create extra semantics for nested values that are not needed here.

Require Object.freeze: rejected because safety comes from detached normalization and shallow copy boundaries, not runtime freezing.

## 19. Explicit Non-Goals

RFC-0010 does not define artifact persistence.

RFC-0010 does not define replay implementation.

RFC-0010 does not define cache-key APIs.

RFC-0010 does not change ExecutionPlan.

RFC-0010 does not change StageDefinition.

RFC-0010 does not change RFC-0009 artifact capture.

RFC-0010 does not define artifact filtering, artifact queries, or artifact transforms.

## 20. Test Matrix

Preflight accepts absent artifactInputBindings and invokes targets without providedArtifacts.

Preflight accepts a target with an empty binding array and invokes that target with providedArtifacts: [].

Preflight accepts a source that is a direct upstream dependency.

Preflight accepts a source that is a transitive upstream ancestor.

Preflight rejects an unknown target stage with INVALID_ARTIFACT_BINDINGS.

Preflight rejects an unknown source stage with INVALID_ARTIFACT_BINDINGS.

Preflight rejects a source that is not a transitive upstream ancestor with INVALID_ARTIFACT_BINDINGS.

Preflight rejects duplicate source bindings for the same target with INVALID_ARTIFACT_BINDINGS.

Preflight rejects symbol keys with INVALID_ARTIFACT_BINDINGS.

Preflight ignores inherited properties.

Preflight coerces numeric keys to strings and validates them as stage IDs.

Preflight guards Reflect.ownKeys, Object.keys, property reads, array reads, and sourceStageId reads.

Preflight treats **proto** cases using Object.defineProperty, Object.create(null), or JSON.parse.

Mutation after normalization has no effect on runtime source selection.

Runtime omits providedArtifacts when no sources are bound.

Runtime passes providedArtifacts: [] when sources are bound and emit no artifacts.

Runtime orders providedArtifacts by plan source order, then RFC-0009 captured order.

Runtime uses detached shallow copies for providedArtifacts.

Runtime fails the current target with EXECUTOR_FAILED when a bound completed upstream source is missing at runtime.

Malformed executor results use EXECUTOR_FAILED.

Executor throws use EXECUTOR_THREW.

## 21. Open Questions

Should a later RFC add artifact-level selectors while preserving source-stage binding as the base model?

Should a later RFC define deep-copy or serialization boundaries for nested artifact metadata?

Should diagnostics for INVALID_ARTIFACT_BINDINGS expose structured details for developer ergonomics?

## 22. Acceptance Criteria

The RFC contains exactly the 22 numbered sections listed in the request.

The public contracts match the required TypeScript definitions.

The internal NormalizedArtifactInputBindings representation is specified.

The document states that ExecutionPlan owns topology and ArtifactInputBindings owns artifact visibility.

The document states that bindings are runtime orchestration input and cannot create dependencies.

The document requires eager validation before any executor invocation.

The document requires detached normalization and forbids reading caller input after normalization.

The document defines INVALID_ARTIFACT_BINDINGS and the six-value failure reason union.

The document defines providedArtifacts absence, empty-array, ordering, and detached shallow-copy semantics.

The document covers hostile-input inspection requirements, including **proto** test construction guidance.