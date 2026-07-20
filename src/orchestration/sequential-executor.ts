/**
 * RFC-0008 & RFC-0010: Sequential Execution Orchestration with Artifact Input Bindings
 *
 * RFC-0008: Minimal sequential execution orchestrator with fail-fast semantics.
 * RFC-0010: Stage artifact input bindings for caller-controlled artifact visibility.
 * No retries, persistence, replay, resume, parallelism, gates, or enrichment.
 */

import { ExecutionPlan, StageDefinition } from '../core/execution-plan.js';

/**
 * Immutable reference to a stage output artifact (RFC-0009).
 * Executor provides these; orchestrator collects and exposes them.
 */
export type StageArtifact = {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly uri: string;
};

/**
 * Caller-provided binding of artifacts from upstream stages (RFC-0010).
 * Each binding references a single source stage whose captured artifacts are visible to a target.
 */
export type ArtifactInputBinding = {
  readonly sourceStageId: string;
};

/**
 * Map of target stage IDs to arrays of artifact input bindings (RFC-0010).
 * Specifies which upstream stages' artifacts are visible to each target stage.
 * Optional; absence means no artifact bindings (backward compatible with RFC-0008/RFC-0009).
 */
export type ArtifactInputBindings = Readonly<
  Record<string, readonly ArtifactInputBinding[]>
>;

/**
 * Input to each executor invocation (RFC-0008 & RFC-0010).
 * Executor does not receive upstream results or outputs except through providedArtifacts (RFC-0010).
 * providedArtifacts is only present if artifacts are bound to this target stage.
 */
export type StageExecutionInput = {
  readonly stageId: string;
  readonly stageKind: string;
  readonly providedArtifacts?: readonly StageArtifact[];
};

/**
 * Output from each executor (RFC-0009 extended).
 * SUCCEEDED must include artifacts array (may be empty).
 * FAILED has no artifacts (fail-fast semantics).
 * Orchestrator normalizes all failures.
 */
export type StageExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly artifacts: readonly StageArtifact[];
    }
  | { readonly status: 'FAILED' };

/**
 * Successful stage execution with collected artifacts (RFC-0009).
 * Single source of truth for stage completion in orchestrator result.
 */
export type CompletedStageExecution = {
  readonly stageId: string;
  readonly artifacts: readonly StageArtifact[];
};

/**
 * Executor function type.
 * Must not mutate inputs.
 */
export type StageExecutor = (
  input: StageExecutionInput
) => Promise<StageExecutionResult>;

/**
 * Complete input to orchestrator (RFC-0008 & RFC-0010).
 * plan, stageDefinitions, and executors must be provided; orchestrator does not modify them.
 * artifactInputBindings is optional; when absent, no artifacts are bound (backward compatible).
 */
export type SequentialExecutionInput = {
  readonly plan: ExecutionPlan;
  readonly stageDefinitions: readonly StageDefinition[];
  readonly executors: Readonly<Record<string, StageExecutor>>;
  readonly artifactInputBindings?: ArtifactInputBindings;
};

/**
 * Failure reason codes (6 total, extended by RFC-0010).
 * Reason is always one of these; no executor-provided text.
 * Details string is stable and orchestrator-controlled.
 * RFC-0008 originally defined 5 codes; RFC-0010 adds INVALID_ARTIFACT_BINDINGS.
 */
export type SequentialExecutionFailureReason =
  | 'DUPLICATE_STAGE_DEFINITION'
  | 'MISSING_STAGE_DEFINITION'
  | 'MISSING_EXECUTOR'
  | 'EXECUTOR_FAILED'
  | 'EXECUTOR_THREW'
  | 'INVALID_ARTIFACT_BINDINGS';

/**
 * Complete output from orchestration (RFC-0009 extended).
 * SUCCEEDED: all stages executed successfully with collected artifacts.
 * FAILED: execution stopped after first failure.
 *
 * completedStages contains only successful stages (failed stage is excluded).
 * Each CompletedStageExecution includes stageId and collected artifacts.
 * failedStageId identifies which stage caused failure (not in completedStages).
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

/**
 * Internal representation of normalized artifact input bindings (RFC-0010).
 * Produced during preflight validation; never read from caller input after creation.
 */
type NormalizedArtifactInputBindings = readonly {
  readonly targetStageId: string;
  readonly sourceStageIds: readonly string[];
}[];

/**
 * Compute all transitive upstream stage IDs from ExecutionPlan topology (RFC-0010).
 * PlannedStage.upstreams is the only topology authority for binding validity.
 */
function computeUpstreamAncestors(
  stageId: string,
  plan: ExecutionPlan
): Set<string> {
  const plannedStage = plan.stages.find((stage) => stage.stageId === stageId);
  return new Set(plannedStage?.upstreams ?? []);
}
/**
 * Validate executor artifacts and create shallow copies for public result.
 * Returns error message if validation fails, otherwise returns orchestrator-owned
 * shallow copies of artifacts (not references to executor's objects).
 *
 * Frozen validation rules (RFC-0009):
 * - artifacts must be an array
 * - each entry must be a non-null object
 * - each entry must have artifactId, artifactKind, uri as strings
 * - empty strings are accepted
 * - duplicates are accepted
 * - extra fields are stripped
 *
 * Returns deep error description for malformed structures,
 * stable error message for overall shape issues.
 */
function validateAndCopyArtifacts(
  artifacts: unknown
): {
  error?: string;
  artifacts: readonly StageArtifact[];
} {
  // Check artifacts is present and an array
  if (!Array.isArray(artifacts)) {
    return {
      error: 'Executor returned an invalid result.',
      artifacts: [],
    };
  }

  // Validate each artifact entry and create shallow copies
  const copied: StageArtifact[] = [];

  for (const entry of artifacts) {
    // Must be non-null object
    if (!entry || typeof entry !== 'object') {
      return {
        error: 'Executor returned artifacts with invalid structure.',
        artifacts: [],
      };
    }

    const artifact = entry as Record<string, unknown>;

    // Must have all three required string fields
    const artifactId = artifact.artifactId;
    const artifactKind = artifact.artifactKind;
    const uri = artifact.uri;

    if (typeof artifactId !== 'string') {
      return {
        error: 'Executor returned artifacts with invalid structure.',
        artifacts: [],
      };
    }

    if (typeof artifactKind !== 'string') {
      return {
        error: 'Executor returned artifacts with invalid structure.',
        artifacts: [],
      };
    }

    if (typeof uri !== 'string') {
      return {
        error: 'Executor returned artifacts with invalid structure.',
        artifacts: [],
      };
    }

    // Create shallow copy with only the three public fields
    copied.push({
      artifactId,
      artifactKind,
      uri,
    });
  }

  return { artifacts: copied };
}

type ArtifactBindingValidationFailure = {
  readonly failedStageId: string;
  readonly details: string;
};

function invalidArtifactBindings(
  failedStageId: string,
  details: string
): { readonly error: ArtifactBindingValidationFailure } {
  return { error: { failedStageId, details } };
}

function validateArtifactBindings(
  bindings: unknown,
  plan: ExecutionPlan
): {
  readonly normalized?: NormalizedArtifactInputBindings;
  readonly error?: ArtifactBindingValidationFailure;
} {
  if (bindings === undefined) {
    return { normalized: [] };
  }

  if (!bindings || typeof bindings !== 'object') {
    return invalidArtifactBindings(
      'unknown',
      'Artifact input bindings must be an object when provided.'
    );
  }

  let ownKeys: (string | symbol)[];
  try {
    ownKeys = Reflect.ownKeys(bindings);
  } catch {
    return invalidArtifactBindings(
      'unknown',
      'Artifact input bindings own-key inspection failed.'
    );
  }

  for (const key of ownKeys) {
    if (typeof key === 'symbol') {
      return invalidArtifactBindings(
        'unknown',
        'Artifact input bindings must not contain symbol keys.'
      );
    }
  }

  let targetKeys: string[];
  try {
    targetKeys = Object.keys(bindings);
  } catch {
    return invalidArtifactBindings(
      'unknown',
      'Artifact input bindings enumerable-key inspection failed.'
    );
  }

  const planStageIds = new Set(plan.stages.map((stage) => stage.stageId));
  const normalizedMap = new Map<
    string,
    { readonly targetStageId: string; readonly sourceStageIds: Set<string> }
  >();

  for (const targetStageId of targetKeys) {
    if (!planStageIds.has(targetStageId)) {
      return invalidArtifactBindings(
        targetStageId,
        `Artifact input bindings target '${targetStageId}' is not in the execution plan.`
      );
    }

    let targetValue: unknown;
    try {
      targetValue = (bindings as Record<string, unknown>)[targetStageId];
    } catch {
      return invalidArtifactBindings(
        targetStageId,
        `Artifact input bindings target '${targetStageId}' could not be read.`
      );
    }

    if (!Array.isArray(targetValue)) {
      return invalidArtifactBindings(
        targetStageId,
        `Artifact input bindings target '${targetStageId}' must be an array.`
      );
    }

    let targetLength: number;
    try {
      targetLength = targetValue.length;
    } catch {
      return invalidArtifactBindings(
        targetStageId,
        `Artifact input bindings target '${targetStageId}' array could not be read.`
      );
    }

    const sourceStageIds = new Set<string>();
    normalizedMap.set(targetStageId, { targetStageId, sourceStageIds });

    for (let index = 0; index < targetLength; index += 1) {
      let bindingEntry: unknown;
      try {
        bindingEntry = targetValue[index];
      } catch {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding ${index} for target '${targetStageId}' could not be read.`
        );
      }

      if (!bindingEntry || typeof bindingEntry !== 'object') {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding ${index} for target '${targetStageId}' must be an object.`
        );
      }

      let sourceStageId: unknown;
      try {
        sourceStageId = (bindingEntry as Record<string, unknown>).sourceStageId;
      } catch {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding ${index} for target '${targetStageId}' sourceStageId could not be read.`
        );
      }

      if (typeof sourceStageId !== 'string') {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding ${index} for target '${targetStageId}' sourceStageId must be a string.`
        );
      }

      if (!planStageIds.has(sourceStageId)) {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding for target '${targetStageId}' references unknown source '${sourceStageId}'.`
        );
      }

      if (sourceStageId === targetStageId) {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding for target '${targetStageId}' must not reference itself.`
        );
      }

      const ancestors = computeUpstreamAncestors(targetStageId, plan);
      if (!ancestors.has(sourceStageId)) {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding for target '${targetStageId}' references non-upstream source '${sourceStageId}'.`
        );
      }

      if (sourceStageIds.has(sourceStageId)) {
        return invalidArtifactBindings(
          targetStageId,
          `Artifact input binding for target '${targetStageId}' duplicates source '${sourceStageId}'.`
        );
      }

      sourceStageIds.add(sourceStageId);
    }
  }

  const normalizedArray: {
    readonly targetStageId: string;
    readonly sourceStageIds: readonly string[];
  }[] = [];
  for (const stage of plan.stages) {
    const entry = normalizedMap.get(stage.stageId);
    if (entry) {
      const sourceStageIds: string[] = [];
      for (const planStage of plan.stages) {
        if (entry.sourceStageIds.has(planStage.stageId)) {
          sourceStageIds.push(planStage.stageId);
        }
      }
      normalizedArray.push({
        targetStageId: entry.targetStageId,
        sourceStageIds,
      });
    }
  }

  return { normalized: normalizedArray };
}

/**
 * Resolve artifact input bindings at runtime (RFC-0010 section 11).
 * For a given target stage, collect all artifacts from bound sources in order.
 * Returns providedArtifacts array (shallow copies) or undefined if no sources bound.
 */
function resolveArtifactInputs(
  targetStageId: string,
  normalizedBindings: NormalizedArtifactInputBindings,
  completedStages: CompletedStageExecution[]
): readonly StageArtifact[] | undefined {
  // Find binding entry for this target
  const bindingEntry = normalizedBindings.find(
    (e) => e.targetStageId === targetStageId
  );

  // If no binding entry, omit providedArtifacts
  if (!bindingEntry) {
    return undefined;
  }

  // Build map of completed stages for fast lookup
  const completedByStageId = new Map<string, CompletedStageExecution>();
  for (const completed of completedStages) {
    completedByStageId.set(completed.stageId, completed);
  }

  // Resolve each source in order
  const provided: StageArtifact[] = [];
  for (const sourceStageId of bindingEntry.sourceStageIds) {
    const completed = completedByStageId.get(sourceStageId);

    // Missing completed source is a runtime failure (RFC-0010 section 11, line 155)
    if (!completed) {
      return undefined; // Signal that this stage should fail with EXECUTOR_FAILED
    }

    // Copy all artifacts from this source in order (RFC-0009 captured order)
    for (const artifact of completed.artifacts) {
      provided.push({
        artifactId: artifact.artifactId,
        artifactKind: artifact.artifactKind,
        uri: artifact.uri,
      });
    }
  }

  // Return array (may be empty if sources are bound but emitted no artifacts)
  return provided;
}

/**
 * Sequential execution orchestrator.
 *
 * Algorithm:
 * 1. Validate stageDefinitions for duplicates (before any executor invocation)
 * 2. For each stage in topological order:
 *    a. Look up StageDefinition by stageId
 *    b. Extract stageKind
 *    c. Look up executor by stageKind
 *    d. Invoke executor
 *    e. Normalize result (success or one of 4 failure codes)
 *    f. On failure: fail-fast, stop execution
 *    g. On success: add to completedStages, continue
 * 3. Return SequentialExecutionResult with status, completedStages, failure info
 *
 * Failure codes (exactly as frozen in RFC-0008):
 * - DUPLICATE_STAGE_DEFINITION: "Duplicate stage definition."
 * - MISSING_STAGE_DEFINITION: orchestrator-provided
 * - MISSING_EXECUTOR: orchestrator-provided
 * - EXECUTOR_FAILED: "Executor reported failure." or "Executor returned an invalid result."
 * - EXECUTOR_THREW: "Executor threw or rejected."
 *
 * Invariants:
 * - completedStages contains only successful stages
 * - failedStageId is excluded from completedStages
 * - failedStageId identifies which stage caused first failure
 * - Remaining stages after first failure are never invoked (fail-fast)
 * - Unused executor entries are ignored (not an error)
 * - Input objects are not mutated
 */
export async function executeSequentialPlan(
  input: SequentialExecutionInput
): Promise<SequentialExecutionResult> {
  const { plan, stageDefinitions, executors, artifactInputBindings } = input;

  // Validation: Detect duplicate stageIds before any executor invocation
  const definitionsByStageId = new Map<string, StageDefinition>();
  for (const def of stageDefinitions) {
    if (definitionsByStageId.has(def.stageId)) {
      return {
        status: 'FAILED',
        completedStages: [],
        failedStageId: def.stageId,
        reason: 'DUPLICATE_STAGE_DEFINITION',
        details: 'Duplicate stage definition.',
      };
    }
    definitionsByStageId.set(def.stageId, def);
  }

  // RFC-0010: Preflight validation of artifact input bindings before any executor invocation
  const bindingsValidation = validateArtifactBindings(artifactInputBindings, plan);
  if (bindingsValidation.error) {
    return {
      status: 'FAILED',
      completedStages: [],
      failedStageId: bindingsValidation.error.failedStageId,
      reason: 'INVALID_ARTIFACT_BINDINGS',
      details: bindingsValidation.error.details,
    };
  }
  const normalizedBindings = bindingsValidation.normalized!;

  const completedStages: CompletedStageExecution[] = [];

  // Execute each stage in topological order
  for (const plannedStage of plan.stages) {
    const stageId = plannedStage.stageId;

    // Step 1: Look up StageDefinition by stageId
    const stageDef = definitionsByStageId.get(stageId);
    if (!stageDef) {
      return {
        status: 'FAILED',
        completedStages,
        failedStageId: stageId,
        reason: 'MISSING_STAGE_DEFINITION',
        details: `Stage ${stageId} not found in stage definitions.`,
      };
    }

    const stageKind = stageDef.stageKind;

    // Step 2: Look up executor by stageKind (prototype-safe)
    if (!Object.hasOwn(executors, stageKind)) {
      return {
        status: 'FAILED',
        completedStages,
        failedStageId: stageId,
        reason: 'MISSING_EXECUTOR',
        details: `No executor registered for stage kind '${stageKind}'.`,
      };
    }
    const executor = executors[stageKind] as StageExecutor;

    // RFC-0010: Resolve artifact inputs from bound upstream sources
    const providedArtifacts = resolveArtifactInputs(
      stageId,
      normalizedBindings,
      completedStages
    );

    // If resolution returned undefined due to missing completed source, fail
    if (
      providedArtifacts === undefined &&
      normalizedBindings.some((e) => e.targetStageId === stageId)
    ) {
      // This target has bindings but a required source is missing
      // This should not happen in normal execution (all upstreams should complete first)
      // but RFC-0010 section 11 requires us to fail with EXECUTOR_FAILED
      return {
        status: 'FAILED',
        completedStages,
        failedStageId: stageId,
        reason: 'EXECUTOR_FAILED',
        details: 'Required upstream source artifact not available.',
      };
    }

    // Step 3: Invoke executor with optional providedArtifacts
    const executionInput: StageExecutionInput =
      providedArtifacts !== undefined
        ? { stageId, stageKind, providedArtifacts }
        : { stageId, stageKind };
    const input = executionInput;

    let result: StageExecutionResult;
    try {
      result = await executor(input);
    } catch (error) {
      // Normalize all thrown/rejected values identically
      return {
        status: 'FAILED',
        completedStages,
        failedStageId: stageId,
        reason: 'EXECUTOR_THREW',
        details: 'Executor threw or rejected.',
      };
    }

    // Step 4: Validate and normalize executor result
    // Wrap inspection and validation in separate boundary to catch property access throws
    try {
      if (!result || typeof result !== 'object') {
        // Malformed: not an object
        return {
          status: 'FAILED',
          completedStages,
          failedStageId: stageId,
          reason: 'EXECUTOR_FAILED',
          details: 'Executor returned an invalid result.',
        };
      }

      const resultStatus = (result as Record<string, unknown>).status;

      if (resultStatus === 'SUCCEEDED') {
        // Validate and collect artifacts (RFC-0009)
        const artifactsValidation = validateAndCopyArtifacts(
          (result as Record<string, unknown>).artifacts
        );

        if (artifactsValidation.error) {
          return {
            status: 'FAILED',
            completedStages,
            failedStageId: stageId,
            reason: 'EXECUTOR_FAILED',
            details: artifactsValidation.error,
          };
        }

        // Success: add to completedStages with collected artifacts, continue
        completedStages.push({
          stageId,
          artifacts: artifactsValidation.artifacts,
        });
        continue;
      }

      if (resultStatus === 'FAILED') {
        // FAILED result must not carry artifacts (RFC-0009)
        const failedResult = result as Record<string, unknown>;
        if ('artifacts' in failedResult) {
          return {
            status: 'FAILED',
            completedStages,
            failedStageId: stageId,
            reason: 'EXECUTOR_FAILED',
            details: 'Executor returned an invalid result.',
          };
        }

        // Executor returned FAILED
        return {
          status: 'FAILED',
          completedStages,
          failedStageId: stageId,
          reason: 'EXECUTOR_FAILED',
          details: 'Executor reported failure.',
        };
      }

      // Malformed: status is neither SUCCEEDED nor FAILED
      return {
        status: 'FAILED',
        completedStages,
        failedStageId: stageId,
        reason: 'EXECUTOR_FAILED',
        details: 'Executor returned an invalid result.',
      };
    } catch (error) {
      // Inspection-time exception: any property access, getter, proxy trap, or validation threw
      return {
        status: 'FAILED',
        completedStages,
        failedStageId: stageId,
        reason: 'EXECUTOR_FAILED',
        details: 'Executor returned an invalid result.',
      };
    }
  }

  // All stages succeeded
  return {
    status: 'SUCCEEDED',
    completedStages,
  };
}
