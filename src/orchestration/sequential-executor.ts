/**
 * RFC-0008: Sequential Execution Orchestration
 *
 * Minimal sequential execution orchestrator with fail-fast semantics.
 * No retries, persistence, replay, resume, parallelism, gates, or enrichment.
 */

import { ExecutionPlan, StageDefinition } from '../core/execution-plan.js';

/**
 * Input to each executor invocation.
 * Executor does not receive upstream results or outputs.
 */
export type StageExecutionInput = {
  readonly stageId: string;
  readonly stageKind: string;
};

/**
 * Output from each executor.
 * Executor provides only status, no reason text or payload.
 * Orchestrator normalizes all failures.
 */
export type StageExecutionResult =
  | { readonly status: 'SUCCEEDED' }
  | { readonly status: 'FAILED' };

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
 * Complete output from orchestration.
 * SUCCEEDED: all stages executed successfully.
 * FAILED: execution stopped after first failure.
 *
 * completedStages contains only successful stages (failed stage is excluded).
 * failedStageId identifies which stage caused failure (not in completedStages).
 */
export type SequentialExecutionResult =
  | {
      readonly status: 'SUCCEEDED';
      readonly completedStages: readonly string[];
    }
  | {
      readonly status: 'FAILED';
      readonly completedStages: readonly string[];
      readonly failedStageId: string;
      readonly reason: SequentialExecutionFailureReason;
      readonly details: string;
    };

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

  const completedStages: string[] = [];

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
      // Success: add to completedStages, continue
      completedStages.push(stageId);
      continue;
    }

    if (resultStatus === 'FAILED') {
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
  }

  // All stages succeeded
  return {
    status: 'SUCCEEDED',
    completedStages,
  };
}
