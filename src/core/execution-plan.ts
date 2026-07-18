/**
 * RFC-0007 Phase 2: Deterministic Execution Planning
 *
 * Minimal contracts for pipeline planning without runtime state.
 */

export type StageDefinition = {
  readonly stageId: string;
  readonly stageKind: string;
  readonly dependsOn: readonly string[];
};

export type PlanningInput = {
  readonly stageDefinitions: readonly StageDefinition[];
  readonly requestedStages: readonly string[];
};

export type PlannedStage = {
  readonly stageId: string;
  readonly upstreams: readonly string[];
};

export type ExecutionPlan = {
  readonly stages: readonly PlannedStage[];
};

export type PlanningError = {
  readonly reason:
    | "UNKNOWN_REQUESTED_STAGE"
    | "UNKNOWN_STAGE_DEPENDENCY"
    | "DEPENDENCY_CYCLE"
    | "DUPLICATE_STAGE_ID";
  readonly details: string;
};
