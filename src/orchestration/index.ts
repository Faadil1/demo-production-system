/**
 * RFC-0008: Sequential Execution Orchestration
 */

export {
  type StageExecutionInput,
  type StageExecutionResult,
  type StageExecutor,
  type SequentialExecutionInput,
  type SequentialExecutionFailureReason,
  type SequentialExecutionResult,
  executeSequentialPlan,
} from './sequential-executor.js';
