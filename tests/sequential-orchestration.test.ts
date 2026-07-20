/**
 * RFC-0008 & RFC-0009: Sequential Execution Orchestration Tests
 *
 * Comprehensive test coverage for executeSequentialPlan() function.
 * Tests cover positive cases, failure modes, edge cases, and RFC-0009 artifact collection.
 */

import { describe, it, expect } from 'vitest';
import {
  executeSequentialPlan,
  type StageArtifact,
  type CompletedStageExecution,
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
  // RFC-0009: Artifact Collection Tests
  // ====================================================================

  describe('RFC-0009: artifact collection', () => {
    it('collects empty artifacts array from successful stage', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages).toHaveLength(1);
      expect(result.completedStages[0].stageId).toBe('stage-1');
      expect(result.completedStages[0].artifacts).toEqual([]);
    });

    it('collects one artifact from successful stage', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const artifact: StageArtifact = {
        artifactId: 'output-1',
        artifactKind: 'result',
        uri: 'file:///tmp/output.txt',
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [artifact],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages[0].artifacts).toHaveLength(1);
      expect(result.completedStages[0].artifacts[0]).toEqual(artifact);
    });

    it('collects multiple artifacts from successful stage in order', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const artifacts: StageArtifact[] = [
        { artifactId: 'a', artifactKind: 'type1', uri: 'uri-a' },
        { artifactId: 'b', artifactKind: 'type2', uri: 'uri-b' },
        { artifactId: 'c', artifactKind: 'type1', uri: 'uri-c' },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts,
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.completedStages[0].artifacts).toEqual(artifacts);
    });

    it('collects artifacts from multiple stages in order', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
      ];

      const executor: StageExecutor = async (input: StageExecutionInput) => {
        if (input.stageId === 'stage-1') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'a1', artifactKind: 'type1', uri: 'uri-a1' }],
          };
        }
        return {
          status: 'SUCCEEDED',
          artifacts: [{ artifactId: 'a2', artifactKind: 'type2', uri: 'uri-a2' }],
        };
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.completedStages).toHaveLength(2);
      expect(result.completedStages[0].artifacts[0].artifactId).toBe('a1');
      expect(result.completedStages[1].artifacts[0].artifactId).toBe('a2');
    });

    it('accepts duplicate artifact IDs within a stage', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [
          { artifactId: 'same', artifactKind: 'type1', uri: 'uri-1' },
          { artifactId: 'same', artifactKind: 'type2', uri: 'uri-2' },
        ],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages[0].artifacts).toHaveLength(2);
    });

    it('accepts duplicate URIs within a stage', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [
          { artifactId: 'id1', artifactKind: 'type1', uri: 'same-uri' },
          { artifactId: 'id2', artifactKind: 'type2', uri: 'same-uri' },
        ],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages[0].artifacts).toHaveLength(2);
    });

    it('accepts empty strings for artifact fields', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [
          { artifactId: '', artifactKind: '', uri: '' },
        ],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages[0].artifacts[0]).toEqual({
        artifactId: '',
        artifactKind: '',
        uri: '',
      });
    });

    it('strips extra artifact fields from output', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [
          {
            artifactId: 'id1',
            artifactKind: 'type1',
            uri: 'uri-1',
            extraField: 'should-be-stripped',
            internalId: 123,
          } as any,
        ],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      const artifact = result.completedStages[0].artifacts[0];
      expect(artifact).toEqual({
        artifactId: 'id1',
        artifactKind: 'type1',
        uri: 'uri-1',
      });
      expect('extraField' in artifact).toBe(false);
      expect('internalId' in artifact).toBe(false);
    });

    it('does not mutate executor-provided artifacts', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executorArtifacts = [
        { artifactId: 'id1', artifactKind: 'type1', uri: 'uri-1' },
      ];
      const originalJson = JSON.stringify(executorArtifacts);

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: executorArtifacts,
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      await executeSequentialPlan(input);

      expect(JSON.stringify(executorArtifacts)).toBe(originalJson);
    });

    it('public artifacts are not aliases to executor objects', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executorArtifact = {
        artifactId: 'id1',
        artifactKind: 'type1',
        uri: 'uri-1',
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [executorArtifact],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;
      const publicArtifact = result.completedStages[0].artifacts[0];

      expect(publicArtifact).toEqual(executorArtifact);
      expect(publicArtifact).not.toBe(executorArtifact);
    });

    it('public artifacts array is not aliased to executor array', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executorArtifacts = [
        { artifactId: 'id1', artifactKind: 'type1', uri: 'uri-1' },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: executorArtifacts,
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;
      const publicArtifacts = result.completedStages[0].artifacts;

      expect(publicArtifacts).not.toBe(executorArtifacts);
    });
  });

  // ====================================================================
  // RFC-0009: Artifact Validation Tests
  // ====================================================================

  describe('RFC-0009: artifact validation', () => {
    it('rejects missing artifacts property', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
      expect(result.failedStageId).toBe('stage-1');
      expect(result.completedStages).toEqual([]);
    });

    it('rejects artifacts: undefined', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: undefined,
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
    });

    it('rejects artifacts: null', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: null,
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
    });

    it('rejects non-array artifacts', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: 'not-an-array',
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
    });

    it('rejects null artifact entry', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [null],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects primitive artifact entry', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: ['string-artifact'],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects missing artifactId', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [{ artifactKind: 'type', uri: 'uri' }],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects non-string artifactId', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [{ artifactId: 123, artifactKind: 'type', uri: 'uri' }],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects missing artifactKind', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [{ artifactId: 'id', uri: 'uri' }],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects non-string artifactKind', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [{ artifactId: 'id', artifactKind: true, uri: 'uri' }],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects missing uri', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [{ artifactId: 'id', artifactKind: 'type' }],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects non-string uri', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [{ artifactId: 'id', artifactKind: 'type', uri: { nested: 'object' } }],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned artifacts with invalid structure.');
    });

    it('rejects FAILED result carrying artifacts property', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'FAILED',
        artifacts: [],
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
    });
  });

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

    it('executes single stage success with artifacts', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [
          { artifactId: 'out-1', artifactKind: 'rendering', uri: 'file:///tmp/frame-001.png' },
        ],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages).toHaveLength(1);
      expect(result.completedStages[0].stageId).toBe('stage-1');
      expect(result.completedStages[0].artifacts).toHaveLength(1);
    });

    it('executes linear pipeline (all succeed) with artifacts', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-3', stageKind: 'work', dependsOn: ['stage-2'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages).toHaveLength(3);
      expect(result.completedStages.map((s: any) => s.stageId)).toEqual([
        'stage-1',
        'stage-2',
        'stage-3',
      ]);
    });

    it('executes diamond DAG in topological order', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-3', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-4', stageKind: 'work', dependsOn: ['stage-2', 'stage-3'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages.map((s: any) => s.stageId)).toEqual([
        'stage-1',
        'stage-2',
        'stage-3',
        'stage-4',
      ]);
    });

    it('does not mutate input objects', async () => {
      const plan: ExecutionPlan = {
        stages: [{ stageId: 'stage-1', upstreams: [] }],
      };
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];
      const executors = {
        work: (async () => ({
          status: 'SUCCEEDED',
          artifacts: [],
        })) as StageExecutor,
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
        artifacts: [],
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
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.completedStages).toEqual([]);
      expect(result.failedStageId).toBe('stage-1');
      expect(result.reason).toBe('DUPLICATE_STAGE_DEFINITION');
      expect(result.details).toBe('Duplicate stage definition.');
    });

    it('detects MISSING_STAGE_DEFINITION', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('MISSING_STAGE_DEFINITION');
      expect(result.failedStageId).toBe('stage-2');
      expect(result.completedStages).toHaveLength(1);
      expect(result.completedStages[0].stageId).toBe('stage-1');
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
        executors: {},
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('MISSING_EXECUTOR');
      expect(result.failedStageId).toBe('stage-1');
      expect(result.completedStages).toEqual([]);
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor reported failure.');
      expect(result.failedStageId).toBe('stage-1');
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_THREW');
      expect(result.details).toBe('Executor threw or rejected.');
      expect(result.failedStageId).toBe('stage-1');
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.reason).toBe('EXECUTOR_THREW');
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
        return { status: 'SUCCEEDED', artifacts: [] };
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(stage3Invoked).toBe(false);
      expect(result.completedStages).toHaveLength(1);
      expect(result.completedStages[0].stageId).toBe('stage-1');
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
        return { status: 'SUCCEEDED', artifacts: [] };
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.completedStages).toEqual([]);
      expect(result.failedStageId).toBe('stage-1');
    });

    it('failure after prior successful stages preserves prior completions', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        { stageId: 'c', stageKind: 'work', dependsOn: ['b'] },
      ];

      const executor: StageExecutor = async (input: StageExecutionInput) => {
        if (input.stageId === 'b') {
          return { status: 'FAILED' };
        }
        return { status: 'SUCCEEDED', artifacts: [] };
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.completedStages).toHaveLength(1);
      expect(result.completedStages[0].stageId).toBe('a');
      expect(result.failedStageId).toBe('b');
    });
  });

  // ====================================================================
  // INSPECTION-TIME EXCEPTIONS AND REGRESSION TESTS
  // ====================================================================

  describe('inspection-time exceptions and regression tests', () => {
    it('throw after prior successful stage — stage 1 succeeds, stage 2 throws', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
      ];

      const executor: StageExecutor = async (input: StageExecutionInput) => {
        if (input.stageId === 'stage-1') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'a1', artifactKind: 'type1', uri: 'uri-a1' }],
          };
        }
        // stage-2 throws
        throw new Error('stage-2 failed');
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_THREW');
      expect(result.details).toBe('Executor threw or rejected.');
      expect(result.failedStageId).toBe('stage-2');
      expect(result.completedStages).toHaveLength(1);
      expect(result.completedStages[0].stageId).toBe('stage-1');
      expect(result.completedStages[0].artifacts[0].artifactId).toBe('a1');
    });

    it('unknown result status — executor returns unsupported status', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const executor: StageExecutor = async () => ({
        status: 'UNKNOWN_STATUS',
      } as any);

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
      expect(result.failedStageId).toBe('stage-1');
      expect(result.completedStages).toEqual([]);
    });

    it('inspection-time exception — reading status throws', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const resultObj = {};
      Object.defineProperty(resultObj, 'status', {
        get() {
          throw new Error('getter threw');
        },
        enumerable: true,
      });

      const executor: StageExecutor = async () => resultObj as any;

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
      expect(result.failedStageId).toBe('stage-1');
      expect(result.completedStages).toEqual([]);
    });

    it('inspection-time exception — reading artifacts throws', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const resultObj = { status: 'SUCCEEDED' };
      Object.defineProperty(resultObj, 'artifacts', {
        get() {
          throw new Error('artifacts getter threw');
        },
        enumerable: true,
      });

      const executor: StageExecutor = async () => resultObj as any;

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
      expect(result.failedStageId).toBe('stage-1');
      expect(result.completedStages).toEqual([]);
    });

    it('inspection-time exception — reading artifact field throws', async () => {
      const stageDef: StageDefinition = {
        stageId: 'stage-1',
        stageKind: 'work',
        dependsOn: [],
      };

      const artifactWithThrowingField = {};
      Object.defineProperty(artifactWithThrowingField, 'artifactId', {
        get() {
          throw new Error('artifactId getter threw');
        },
        enumerable: true,
      });

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [artifactWithThrowingField as any],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: [stageDef],
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.details).toBe('Executor returned an invalid result.');
      expect(result.failedStageId).toBe('stage-1');
      expect(result.completedStages).toEqual([]);
    });

    it('inspection-time exception preserves prior successful stages', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
        { stageId: 'stage-2', stageKind: 'work', dependsOn: ['stage-1'] },
        { stageId: 'stage-3', stageKind: 'work', dependsOn: ['stage-2'] },
      ];

      const resultObj = { status: 'SUCCEEDED' };
      Object.defineProperty(resultObj, 'artifacts', {
        get() {
          throw new Error('artifacts getter threw');
        },
        enumerable: true,
      });

      const executor: StageExecutor = async (input: StageExecutionInput) => {
        if (input.stageId === 'stage-1') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'a1', artifactKind: 'type1', uri: 'uri-a1' }],
          };
        }
        if (input.stageId === 'stage-2') {
          return resultObj as any;
        }
        return { status: 'SUCCEEDED', artifacts: [] };
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

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('EXECUTOR_FAILED');
      expect(result.failedStageId).toBe('stage-2');
      expect(result.completedStages).toHaveLength(1);
      expect(result.completedStages[0].stageId).toBe('stage-1');
      expect(result.completedStages[0].artifacts[0].artifactId).toBe('a1');
    });
  });

  // ====================================================================
  // EDGE CASES
  // ====================================================================

  describe('edge cases', () => {
    it('prototype key: __proto__ not resolved from Object.prototype', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: '__proto__', dependsOn: [] },
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {},
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('MISSING_EXECUTOR');
      expect(result.failedStageId).toBe('stage-1');
      expect(result.completedStages).toEqual([]);
    });

    it('prototype key: constructor not resolved from Object.prototype', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'constructor', dependsOn: [] },
      ];

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {},
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('MISSING_EXECUTOR');
      expect(result.failedStageId).toBe('stage-1');
    });

    it('prototype key: explicitly provided executor executes successfully', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'toString', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: {
          toString: executor,
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect(result.completedStages).toHaveLength(1);
    });
  });
});
