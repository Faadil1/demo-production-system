/**
 * RFC-0008 & RFC-0009: Sequential Execution Orchestration
 */

export {
  type StageArtifact,
  type CompletedStageExecution,
  type StageExecutionInput,
  type StageExecutionResult,
  type StageExecutor,
  type SequentialExecutionInput,
  type SequentialExecutionFailureReason,
  type SequentialExecutionResult,
  executeSequentialPlan,
} from './sequential-executor.js';
