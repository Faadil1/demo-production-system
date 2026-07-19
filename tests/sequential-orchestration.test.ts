/**
 * RFC-0008: Sequential Execution Orchestration Tests
 *
 * Comprehensive test coverage for executeSequentialPlan() function.
 * Tests cover positive cases, failure modes, edge cases, and invariants.
 */

import { describe, it, expect } from 'vitest';
import {
  executeSequentialPlan,
  type StageExecutionInput,
  type StageExecutionResult,
  type StageExecutor,
  type SequentialExecutionInput,
  type SequentialExecutionResult,
} from '../src/orchestration/index.js';
import {
  type ExecutionPlan,
  type StageDefinition,
} from '../src/core/execution-plan.js';

describe('executeSequentialPlan', () => {
  // ====================================================================
  // POSITIVE CASES: Expected success paths
  // ====================================================================

  describe('positive: success cases', () => {
    it('executes empty plan successfully', async () => {
      const input: SequentialExecutionInput = {
        plan: { stages: [] },
        stageDefinitions: [],
        executors: {},
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: [],
      });
    });

    it('executes single stage success', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: ['stage-1'],
      });
    });

    it('executes linear pipeline (all succeed)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-3', stageKind: 'work', dependsOn: ['stage-2'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] },
            { stageId: 'stage-3', upstreams: ['stage-2'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: ['stage-1', 'stage-2', 'stage-3'],
      });
    });

    it('executes diamond DAG in topological order', async () => {
      // stage-1 → {stage-2, stage-3} → stage-4
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-3', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-4', stageKind: 'work', dependsOn: ['stage-2', 'stage-3'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] },
            { stageId: 'stage-3', upstreams: ['stage-1'] },
            { stageId: 'stage-4', upstreams: ['stage-2', 'stage-3'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: ['stage-1', 'stage-2', 'stage-3', 'stage-4'],
      });
    });

    it('preserves completedStages order (topological)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        { stageId: 'c', stageKind: 'work', dependsOn: ['a'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
            { stageId: 'c', upstreams: ['a'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).completedStages).toEqual(['a', 'b', 'c']);
    });

    it('ignores unused executor registry entries', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const usedExecutor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });
      const unusedExecutor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {
          work: usedExecutor,
          unused: unusedExecutor,
        },
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: ['stage-1'],
      });
    });

    it('does not mutate input objects', async () => {
      const plan: ExecutionPlan = {
        stages: [{ stageId: 'stage-1', upstreams: [] }],
      };
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];
      const executors = {
        work: (async () => ({ status: 'SUCCEEDED' })) as StageExecutor,
      };

      const originalPlanJson = JSON.stringify(plan);
      const originalDefsJson = JSON.stringify(defs);
      const originalExecutorsJson = JSON.stringify(executors);

      const input: SequentialExecutionInput = {
        plan,
        stageDefinitions: defs,
        executors,
      };

      await executeSequentialPlan(input);

      expect(JSON.stringify(plan)).toBe(originalPlanJson);
      expect(JSON.stringify(defs)).toBe(originalDefsJson);
      expect(JSON.stringify(executors)).toBe(originalExecutorsJson);
    });

    it('returns deterministic result ordering on repeated invocation', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result1 = await executeSequentialPlan(input);
      const result2 = await executeSequentialPlan(input);

      expect(result1).toEqual(result2);
    });
  });

  // ====================================================================
  // FAILURE: Validation failures (before executor invocation)
  // ====================================================================

  describe('failure: validation (before executor invocation)', () => {
    it('detects DUPLICATE_STAGE_DEFINITION', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] }, // duplicate
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'stage-1',
        reason: 'DUPLICATE_STAGE_DEFINITION',
        details: 'Duplicate stage definition.',
      });
    });

    it('returns DUPLICATE_STAGE_DEFINITION with empty completedStages', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] }, // duplicate
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] }, // would be executed if not for duplicate
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).completedStages).toEqual([]);
    });

    it('detects MISSING_STAGE_DEFINITION', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] }, // not in defs
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('MISSING_STAGE_DEFINITION');
      expect((result as any).failedStageId).toBe('stage-2');
      expect((result as any).completedStages).toEqual(['stage-1']);
      expect((result as any).details).toBe('Stage stage-2 not found in stage definitions.');
    });
  });

  // ====================================================================
  // FAILURE: Runtime failures (during executor invocation)
  // ====================================================================

  describe('failure: runtime (during execution)', () => {
    it('detects MISSING_EXECUTOR', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'missing-kind', dependsOn: [] },
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {}, // no executor for 'missing-kind'
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('MISSING_EXECUTOR');
      expect((result as any).failedStageId).toBe('stage-1');
      expect((result as any).completedStages).toEqual([]);
      expect((result as any).details).toBe("No executor registered for stage kind 'missing-kind'.");
    });

    it('detects EXECUTOR_FAILED: { status: "FAILED" }', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'FAILED',
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('EXECUTOR_FAILED');
      expect((result as any).details).toBe('Executor reported failure.');
      expect((result as any).failedStageId).toBe('stage-1');
    });

    it('detects EXECUTOR_FAILED: malformed result (not an object)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        return null as any;
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('EXECUTOR_FAILED');
      expect((result as any).details).toBe('Executor returned an invalid result.');
    });

    it('detects EXECUTOR_FAILED: malformed result (missing status)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        return { someField: 'value' } as any;
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('EXECUTOR_FAILED');
      expect((result as any).details).toBe('Executor returned an invalid result.');
    });

    it('detects EXECUTOR_FAILED: malformed result (invalid status value)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        return { status: 'UNKNOWN' } as any;
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).reason).toBe('EXECUTOR_FAILED');
      expect((result as any).details).toBe('Executor returned an invalid result.');
    });

    it('detects EXECUTOR_THREW: thrown Error', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        throw new Error('Something went wrong');
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('EXECUTOR_THREW');
      expect((result as any).details).toBe('Executor threw or rejected.');
      expect((result as any).failedStageId).toBe('stage-1');
    });

    it('detects EXECUTOR_THREW: thrown string', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).reason).toBe('EXECUTOR_THREW');
      expect((result as any).details).toBe('Executor threw or rejected.');
    });

    it('detects EXECUTOR_THREW: thrown null', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        throw null; // eslint-disable-line no-throw-literal
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).reason).toBe('EXECUTOR_THREW');
    });

    it('detects EXECUTOR_THREW: thrown undefined', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        throw undefined; // eslint-disable-line no-throw-literal
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).reason).toBe('EXECUTOR_THREW');
    });

    it('detects EXECUTOR_THREW: Promise rejection', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => {
        return Promise.reject(new Error('rejected'));
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).reason).toBe('EXECUTOR_THREW');
    });
  });

  // ====================================================================
  // FAIL-FAST: Verify later stages are not invoked after first failure
  // ====================================================================

  describe('fail-fast semantics', () => {
    it('stops after first failure (remaining stages not invoked)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-3', stageKind: 'work', dependsOn: ['stage-2'] },
      ];

      let stage3Invoked = false;
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        if (input.stageId === 'stage-3') {
          stage3Invoked = true;
        }
        if (input.stageId === 'stage-2') {
          return { status: 'FAILED' };
        }
        return { status: 'SUCCEEDED' };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] },
            { stageId: 'stage-3', upstreams: ['stage-2'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      expect(stage3Invoked).toBe(false);
      expect((result as any).completedStages).toEqual(['stage-1']);
    });

    it('excludes failed stage from completedStages', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
      ];

      const executor: StageExecutor = async (input: StageExecutionInput) => {
        if (input.stageId === 'stage-1') {
          return { status: 'FAILED' };
        }
        return { status: 'SUCCEEDED' };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      // completedStages should not include the failed stage
      expect((result as any).completedStages).toEqual([]);
      expect((result as any).failedStageId).toBe('stage-1');
    });

    it('excludes failed stage from completedStages (verification)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        { stageId: 'c', stageKind: 'work', dependsOn: ['b'] },
      ];

      const executor: StageExecutor = async (input: StageExecutionInput) => {
        if (input.stageId === 'b') {
          return { status: 'FAILED' };
        }
        return { status: 'SUCCEEDED' };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
            { stageId: 'c', upstreams: ['b'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = await executeSequentialPlan(input);

      // 'a' succeeded, 'b' failed (not in completedStages), 'c' never invoked
      expect((result as any).completedStages).toEqual(['a']);
      expect((result as any).failedStageId).toBe('b');
    });
  });

  // ====================================================================
  // EDGE CASES
  // ====================================================================

  describe('edge cases', () => {
    it('handles multiple stageKinds', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'kind-a', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'kind-b', dependsOn: ['stage-1'] },
        { stageId: 'stage-3', stageKind: 'kind-a', dependsOn: ['stage-2'] },
      ];

      const executorA: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });
      const executorB: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'stage-1', upstreams: [] },
            { stageId: 'stage-2', upstreams: ['stage-1'] },
            { stageId: 'stage-3', upstreams: ['stage-2'] },
          ],
        },
        stageDefinitions: defs,
        executors: {
          'kind-a': executorA,
          'kind-b': executorB,
        },
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: ['stage-1', 'stage-2', 'stage-3'],
      });
    });

    it('handles long stageIds and details strings', async () => {
      const longId = 'stage-' + 'x'.repeat(100);
      const defs: StageDefinition[] = [
        { stageId: longId, stageKind: 'work', dependsOn: [] },
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'missing', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: async () => ({ status: 'SUCCEEDED' }) },
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).reason).toBe('MISSING_STAGE_DEFINITION');
      expect((result as any).details).toContain('missing');
    });

    it('prototype key: __proto__ not resolved from Object.prototype', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: '__proto__', dependsOn: [] },
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {}, // no own property __proto__
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('MISSING_EXECUTOR');
      expect((result as any).failedStageId).toBe('stage-1');
      expect((result as any).completedStages).toEqual([]);
      expect((result as any).details).toBe("No executor registered for stage kind '__proto__'.");
    });

    it('prototype key: constructor not resolved from Object.prototype', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'constructor', dependsOn: [] },
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {}, // no own property constructor
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('MISSING_EXECUTOR');
      expect((result as any).failedStageId).toBe('stage-1');
      expect((result as any).completedStages).toEqual([]);
      expect((result as any).details).toBe("No executor registered for stage kind 'constructor'.");
    });

    it('prototype key: toString not resolved from Object.prototype', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'toString', dependsOn: [] },
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {}, // no own property toString
      };

      const result = await executeSequentialPlan(input);

      expect((result as any).status).toBe('FAILED');
      expect((result as any).reason).toBe('MISSING_EXECUTOR');
      expect((result as any).failedStageId).toBe('stage-1');
      expect((result as any).completedStages).toEqual([]);
      expect((result as any).details).toBe("No executor registered for stage kind 'toString'.");
    });

    it('prototype key: explicitly provided executor executes successfully', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'toString', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {
          toString: executor, // explicitly provided as own property
        },
      };

      const result = await executeSequentialPlan(input);

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: ['stage-1'],
      });
    });
  });

  // ====================================================================
  // TYPE SAFETY: Verify contract types are correct
  // ====================================================================

  describe('type safety', () => {
    it('returns correct union type for success', async () => {
      const input: SequentialExecutionInput = {
        plan: { stages: [] },
        stageDefinitions: [],
        executors: {},
      };

      const result = await executeSequentialPlan(input);

      if (result.status === 'SUCCEEDED') {
        // Type narrowing should work
        const completed: readonly string[] = result.completedStages;
        expect(completed).toBeDefined();
      } else {
        throw new Error('Expected SUCCEEDED');
      }
    });

    it('returns correct union type for failure', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] }, // duplicate
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: async () => ({ status: 'SUCCEEDED' }) },
      };

      const result = await executeSequentialPlan(input);

      if (result.status === 'FAILED') {
        // Type narrowing should work
        const failedId: string = result.failedStageId;
        const reason: string = result.reason;
        const details: string = result.details;
        expect(failedId).toBeDefined();
        expect(reason).toBeDefined();
        expect(details).toBeDefined();
      } else {
        throw new Error('Expected FAILED');
      }
    });
  });
});
