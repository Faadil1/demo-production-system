import {
  type StageDefinition,
  type PlanningInput,
  type ExecutionPlan,
  type PlanningError,
  type PlannedStage,
} from "../core/execution-plan.js";

export function createExecutionPlan(
  input: PlanningInput
): ExecutionPlan | PlanningError {
  const validation = validateInput(input);
  if (validation !== null) {
    return validation;
  }

  const stageMap = new Map<string, StageDefinition>();
  for (const stage of input.stageDefinitions) {
    stageMap.set(stage.stageId, stage);
  }

  const cycleError = detectCycle(stageMap);
  if (cycleError !== null) {
    return cycleError;
  }

  const allStages = expandTransitiveDependencies(
    stageMap,
    input.requestedStages
  );

  const sorted = topologicalSort(stageMap, allStages);

  const stages: PlannedStage[] = sorted.map((stageId) => {
    const stage = stageMap.get(stageId)!;
    const upstreams = Array.from(computeUpstreams(stageMap, stage));
    return {
      stageId,
      upstreams: upstreams.sort(),
    };
  });

  return { stages };
}

function validateInput(input: PlanningInput): PlanningError | null {
  const seenIds = new Set<string>();

  for (const stage of input.stageDefinitions) {
    if (seenIds.has(stage.stageId)) {
      return {
        reason: "DUPLICATE_STAGE_ID",
        details: `Stage ID "${stage.stageId}" appears multiple times.`,
      };
    }
    seenIds.add(stage.stageId);
  }

  for (const requestedStageId of input.requestedStages) {
    if (!seenIds.has(requestedStageId)) {
      return {
        reason: "UNKNOWN_REQUESTED_STAGE",
        details: `Requested stage "${requestedStageId}" does not exist.`,
      };
    }
  }

  for (const stage of input.stageDefinitions) {
    for (const dep of stage.dependsOn) {
      if (!seenIds.has(dep)) {
        return {
          reason: "UNKNOWN_STAGE_DEPENDENCY",
          details: `Stage "${stage.stageId}" depends on unknown stage "${dep}".`,
        };
      }
      if (dep === stage.stageId) {
        return {
          reason: "DEPENDENCY_CYCLE",
          details: `Stage "${stage.stageId}" depends on itself.`,
        };
      }
    }
  }

  return null;
}

function detectCycle(
  stageMap: Map<string, StageDefinition>
): PlanningError | null {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(stageId: string): boolean {
    if (stack.has(stageId)) {
      return true;
    }
    if (visited.has(stageId)) {
      return false;
    }

    visited.add(stageId);
    stack.add(stageId);

    const stage = stageMap.get(stageId);
    if (stage) {
      for (const dep of stage.dependsOn) {
        if (visit(dep)) {
          return true;
        }
      }
    }

    stack.delete(stageId);
    return false;
  }

  for (const stageId of stageMap.keys()) {
    if (visit(stageId)) {
      return {
        reason: "DEPENDENCY_CYCLE",
        details: `Dependency cycle detected involving stage "${stageId}".`,
      };
    }
  }

  return null;
}

function expandTransitiveDependencies(
  stageMap: Map<string, StageDefinition>,
  requestedStages: readonly string[]
): Set<string> {
  const included = new Set<string>();
  const queue = [...requestedStages];

  while (queue.length > 0) {
    const stageId = queue.shift()!;
    if (included.has(stageId)) {
      continue;
    }

    included.add(stageId);
    const stage = stageMap.get(stageId);
    if (stage) {
      for (const dep of stage.dependsOn) {
        if (!included.has(dep)) {
          queue.push(dep);
        }
      }
    }
  }

  return included;
}

function topologicalSort(
  stageMap: Map<string, StageDefinition>,
  stages: Set<string>
): string[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const stageId of stages) {
    inDegree.set(stageId, 0);
    adjList.set(stageId, []);
  }

  for (const stageId of stages) {
    const stage = stageMap.get(stageId)!;
    for (const dep of stage.dependsOn) {
      if (stages.has(dep)) {
        adjList.get(dep)!.push(stageId);
        inDegree.set(stageId, (inDegree.get(stageId) ?? 0) + 1);
      }
    }
  }

  const queue = Array.from(stages)
    .filter((stageId) => inDegree.get(stageId) === 0)
    .sort();

  const sorted: string[] = [];

  while (queue.length > 0) {
    queue.sort();
    const stageId = queue.shift()!;
    sorted.push(stageId);

    const neighbors = adjList.get(stageId) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  return sorted;
}

function computeUpstreams(
  stageMap: Map<string, StageDefinition>,
  stage: StageDefinition
): Set<string> {
  const upstreams = new Set<string>();
  const queue = [...stage.dependsOn];

  while (queue.length > 0) {
    const dep = queue.shift()!;
    if (upstreams.has(dep)) {
      continue;
    }

    upstreams.add(dep);
    const depStage = stageMap.get(dep);
    if (depStage) {
      for (const transitiveDep of depStage.dependsOn) {
        if (!upstreams.has(transitiveDep)) {
          queue.push(transitiveDep);
        }
      }
    }
  }

  return upstreams;
}
