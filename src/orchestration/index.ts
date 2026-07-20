/**
 * RFC-0008, RFC-0009 & RFC-0010: Sequential Execution Orchestration with Artifact Bindings
 */

export {
  type StageArtifact,
  type ArtifactInputBinding,
  type ArtifactInputBindings,
  type CompletedStageExecution,
  type StageExecutionInput,
  type StageExecutionResult,
  type StageExecutor,
  type SequentialExecutionInput,
  type SequentialExecutionFailureReason,
  type SequentialExecutionResult,
  executeSequentialPlan,
} from './sequential-executor.js';
