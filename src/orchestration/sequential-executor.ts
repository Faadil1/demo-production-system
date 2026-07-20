/**
 * RFC-0008: Sequential Execution Orchestration
 *
 * Minimal sequential execution orchestrator with fail-fast semantics.
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
 * Input to each executor invocation.
 * Executor does not receive upstream results or outputs.
 */
export type StageExecutionInput = {
  readonly stageId: string;
  readonly stageKind: string;
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
 * Complete input to orchestrator.
 * All three components must be provided; orchestrator does not modify them.
 */
export type SequentialExecutionInput = {
  readonly plan: ExecutionPlan;
  readonly stageDefinitions: readonly StageDefinition[];
  readonly executors: Readonly<Record<string, StageExecutor>>;
};

/**
 * Failure reason codes (5 total).
 * Reason is always one of these; no executor-provided text.
 * Details string is stable and orchestrator-controlled.
 */
export type SequentialExecutionFailureReason =
  | 'DUPLICATE_STAGE_DEFINITION'
  | 'MISSING_STAGE_DEFINITION'
  | 'MISSING_EXECUTOR'
  | 'EXECUTOR_FAILED'
  | 'EXECUTOR_THREW';

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
  const { plan, stageDefinitions, executors } = input;

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

    // Step 3: Invoke executor
    const input: StageExecutionInput = { stageId, stageKind };

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
