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
  type ArtifactInputBindings,
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
            { stageId: 'c', upstreams: ['a', 'b'] },
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
    it('throw after prior successful stage - stage 1 succeeds, stage 2 throws', async () => {
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

    it('unknown result status - executor returns unsupported status', async () => {
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

    it('inspection-time exception - reading status throws', async () => {
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

    it('inspection-time exception - reading artifacts throws', async () => {
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

    it('inspection-time exception - reading artifact field throws', async () => {
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

  // ====================================================================
  // RFC-0010: Artifact Input Bindings Tests
  // ====================================================================

  describe('RFC-0010: artifact input bindings', () => {
    it('accepts absent artifactInputBindings and omits providedArtifacts', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'stage-1', stageKind: 'work', dependsOn: [] },
      ];

      const receivedInput: StageExecutionInput[] = [];
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInput.push(input);
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'stage-1', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInput as any)[0].providedArtifacts).toBeUndefined();
    });

    it('accepts empty artifactInputBindings', async () => {
      const defs: StageDefinition[] = [
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
        artifactInputBindings: {},
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
    });

    it('accepts binding to direct upstream and passes artifacts', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
      ];

      const receivedInputs: StageExecutionInput[] = [];
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInputs.push(input);
        if (input.stageId === 'a') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'out-a', artifactKind: 'type', uri: 'uri-a' }],
          };
        }
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          b: [{ sourceStageId: 'a' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInputs as any)[1].providedArtifacts).toHaveLength(1);
      expect((receivedInputs as any)[1].providedArtifacts?.[0].artifactId).toBe('out-a');
    });

    it('accepts binding to transitive upstream ancestor', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        { stageId: 'c', stageKind: 'work', dependsOn: ['b'] },
      ];

      const receivedInputs: StageExecutionInput[] = [];
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInputs.push(input);
        if (input.stageId === 'a') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'out-a', artifactKind: 'type', uri: 'uri-a' }],
          };
        }
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
            { stageId: 'c', upstreams: ['a', 'b'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          c: [{ sourceStageId: 'a' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInputs as any)[2].providedArtifacts).toHaveLength(1);
      expect((receivedInputs as any)[2].providedArtifacts?.[0].artifactId).toBe('out-a');
    });

    it('accepts binding to multiple sources and concatenates artifacts', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: [] },
        { stageId: 'c', stageKind: 'work', dependsOn: ['a', 'b'] },
      ];

      const receivedInputs: StageExecutionInput[] = [];
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInputs.push(input);
        if (input.stageId === 'a') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'out-a', artifactKind: 'type', uri: 'uri-a' }],
          };
        }
        if (input.stageId === 'b') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'out-b', artifactKind: 'type', uri: 'uri-b' }],
          };
        }
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: [] },
            { stageId: 'c', upstreams: ['a', 'b'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          c: [{ sourceStageId: 'a' }, { sourceStageId: 'b' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInputs as any)[2].providedArtifacts).toHaveLength(2);
      expect((receivedInputs as any)[2].providedArtifacts?.[0].artifactId).toBe('out-a');
      expect((receivedInputs as any)[2].providedArtifacts?.[1].artifactId).toBe('out-b');
    });

    it('accepts empty source list and provides empty array', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
      ];

      const receivedInputs: StageExecutionInput[] = [];
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInputs.push(input);
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'a', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          a: [],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInputs as any)[0].providedArtifacts).toEqual([]);
    });

    it('rejects unknown target stage', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'a', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          unknown: [{ sourceStageId: 'a' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('INVALID_ARTIFACT_BINDINGS');
    });

    it('rejects unknown source stage', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'a', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          a: [{ sourceStageId: 'unknown' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('INVALID_ARTIFACT_BINDINGS');
    });

    it('rejects non-upstream source (sibling)', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: [] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          a: [{ sourceStageId: 'b' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('INVALID_ARTIFACT_BINDINGS');
    });

    it('rejects downstream source', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          a: [{ sourceStageId: 'b' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('INVALID_ARTIFACT_BINDINGS');
    });

    it('rejects duplicate source binding for same target', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          b: [{ sourceStageId: 'a' }, { sourceStageId: 'a' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('INVALID_ARTIFACT_BINDINGS');
    });

    it('rejects symbol keys in bindings object', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const bindings = { a: [{ sourceStageId: 'a' }] } as any;
      (bindings as any)[Symbol.iterator] = () => {};

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'a', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: bindings,
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('INVALID_ARTIFACT_BINDINGS');
    });

    it('ignores inherited properties in bindings object', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
      ];

      const executor: StageExecutor = async () => ({
        status: 'SUCCEEDED',
        artifacts: [],
      });

      const parent = { inherited: [{ sourceStageId: 'unknown' }] };
      const bindings = Object.create(parent);
      bindings.b = [{ sourceStageId: 'a' }];

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: bindings as any,
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
    });

    it('normalizes sources by plan order, not caller order', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: [] },
        { stageId: 'c', stageKind: 'work', dependsOn: ['a', 'b'] },
      ];

      const receivedInputs: StageExecutionInput[] = [];
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInputs.push(input);
        if (input.stageId === 'a') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'out-a', artifactKind: 'type', uri: 'uri-a' }],
          };
        }
        if (input.stageId === 'b') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'out-b', artifactKind: 'type', uri: 'uri-b' }],
          };
        }
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: [] },
            { stageId: 'c', upstreams: ['a', 'b'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          c: [{ sourceStageId: 'b' }, { sourceStageId: 'a' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInputs as any)[2].providedArtifacts?.[0].artifactId).toBe('out-a');
      expect((receivedInputs as any)[2].providedArtifacts?.[1].artifactId).toBe('out-b');
    });

    it('mutation after normalization has no effect', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
      ];

      const receivedInputs: StageExecutionInput[] = [];
      let callCount = 0;
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInputs.push(input);
        if (input.stageId === 'a') {
          return {
            status: 'SUCCEEDED',
            artifacts: [{ artifactId: 'out-a', artifactKind: 'type', uri: 'uri-a' }],
          };
        }
        // Only mutate after 'a' is invoked but before 'b' is invoked
        if (callCount === 1) {
          (input as any).providedArtifacts = [
            {
              artifactId: 'modified',
              artifactKind: 'fake',
              uri: 'fake-uri',
            },
          ];
        }
        callCount++;
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const bindings: any = {
        b: [{ sourceStageId: 'a' }],
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: bindings,
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInputs as any)[1].providedArtifacts?.[0].artifactId).toBe('out-a');
    });

    it('artifact bindings preflight failure prevents any executor invocation', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
      ];

      let executorCalled = false;
      const executor: StageExecutor = async () => {
        executorCalled = true;
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: { stages: [{ stageId: 'a', upstreams: [] }] },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          unknown: [{ sourceStageId: 'a' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('INVALID_ARTIFACT_BINDINGS');
      expect(executorCalled).toBe(false);
    });

    it('rejects explicit null artifactInputBindings with structured failure', async () => {
      let executorCalls = 0;
      const result = await executeSequentialPlan({
        plan: { stages: [{ stageId: 'a', upstreams: [] }] },
        stageDefinitions: [{ stageId: 'a', stageKind: 'work', dependsOn: [] }],
        executors: {
          work: async () => {
            executorCalls += 1;
            return { status: 'SUCCEEDED', artifacts: [] };
          },
        },
        artifactInputBindings: null as unknown as ArtifactInputBindings,
      });

      expect(result).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'unknown',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: 'Artifact input bindings must be an object when provided.',
      });
      expect(executorCalls).toBe(0);
    });

    it('reports exact structured failures for invalid binding shapes', async () => {
      const base = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        ],
      } satisfies Pick<SequentialExecutionInput, 'plan' | 'stageDefinitions'>;

      const cases: readonly {
        readonly name: string;
        readonly bindings: unknown;
        readonly failedStageId: string;
        readonly details: string;
      }[] = [
        {
          name: 'unknown target',
          bindings: { missing: [{ sourceStageId: 'a' }] },
          failedStageId: 'missing',
          details: "Artifact input bindings target 'missing' is not in the execution plan.",
        },
        {
          name: 'target value not array',
          bindings: { b: { sourceStageId: 'a' } },
          failedStageId: 'b',
          details: "Artifact input bindings target 'b' must be an array.",
        },
        {
          name: 'malformed binding object',
          bindings: { b: [null] },
          failedStageId: 'b',
          details: "Artifact input binding 0 for target 'b' must be an object.",
        },
        {
          name: 'sourceStageId non-string',
          bindings: { b: [{ sourceStageId: 123 }] },
          failedStageId: 'b',
          details: "Artifact input binding 0 for target 'b' sourceStageId must be a string.",
        },
        {
          name: 'unknown source',
          bindings: { b: [{ sourceStageId: 'missing' }] },
          failedStageId: 'b',
          details: "Artifact input binding for target 'b' references unknown source 'missing'.",
        },
        {
          name: 'self-reference',
          bindings: { b: [{ sourceStageId: 'b' }] },
          failedStageId: 'b',
          details: "Artifact input binding for target 'b' must not reference itself.",
        },
        {
          name: 'non-upstream source',
          bindings: { a: [{ sourceStageId: 'b' }] },
          failedStageId: 'a',
          details: "Artifact input binding for target 'a' references non-upstream source 'b'.",
        },
        {
          name: 'duplicate source',
          bindings: { b: [{ sourceStageId: 'a' }, { sourceStageId: 'a' }] },
          failedStageId: 'b',
          details: "Artifact input binding for target 'b' duplicates source 'a'.",
        },
      ];

      for (const testCase of cases) {
        let executorCalls = 0;
        const result = await executeSequentialPlan({
          ...base,
          executors: {
            work: async () => {
              executorCalls += 1;
              return { status: 'SUCCEEDED', artifacts: [] };
            },
          },
          artifactInputBindings: testCase.bindings as ArtifactInputBindings,
        });

        expect(testCase.name).toBe(testCase.name);
        expect(result).toEqual({
          status: 'FAILED',
          completedStages: [],
          failedStageId: testCase.failedStageId,
          reason: 'INVALID_ARTIFACT_BINDINGS',
          details: testCase.details,
        });
        expect(executorCalls).toBe(0);
      }
    });

    it('rejects hostile global key inspection failures with exact details', async () => {
      const baseInput = {
        plan: { stages: [{ stageId: 'a', upstreams: [] }] },
        stageDefinitions: [{ stageId: 'a', stageKind: 'work', dependsOn: [] }],
        executors: { work: async () => ({ status: 'SUCCEEDED' as const, artifacts: [] }) },
      };

      const ownKeysFailure = new Proxy({}, {
        ownKeys() {
          throw new Error('ownKeys failed');
        },
      });
      const ownKeysResult = await executeSequentialPlan({
        ...baseInput,
        artifactInputBindings: ownKeysFailure as ArtifactInputBindings,
      });
      expect(ownKeysResult).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'unknown',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: 'Artifact input bindings own-key inspection failed.',
      });

      const objectKeysFailureTarget = {};
      Object.defineProperty(objectKeysFailureTarget, 'a', {
        enumerable: true,
        configurable: true,
        get() {
          return [];
        },
      });
      const objectKeysFailure = new Proxy(objectKeysFailureTarget, {
        getOwnPropertyDescriptor() {
          throw new Error('keys failed');
        },
      });
      const objectKeysResult = await executeSequentialPlan({
        ...baseInput,
        artifactInputBindings: objectKeysFailure as ArtifactInputBindings,
      });
      expect(objectKeysResult).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'unknown',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: 'Artifact input bindings enumerable-key inspection failed.',
      });
    });

    it('rejects hostile property and source reads with exact details', async () => {
      const baseInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        ],
        executors: { work: async () => ({ status: 'SUCCEEDED' as const, artifacts: [] }) },
      };

      const targetGetterThrows = {};
      Object.defineProperty(targetGetterThrows, 'b', {
        enumerable: true,
        get() {
          throw new Error('target getter failed');
        },
      });
      const targetResult = await executeSequentialPlan({
        ...baseInput,
        artifactInputBindings: targetGetterThrows as ArtifactInputBindings,
      });
      expect(targetResult).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'b',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: "Artifact input bindings target 'b' could not be read.",
      });

      const arrayIndexThrows = [] as unknown[];
      Object.defineProperty(arrayIndexThrows, '0', {
        enumerable: true,
        get() {
          throw new Error('index failed');
        },
      });
      Object.defineProperty(arrayIndexThrows, 'length', { value: 1 });
      const indexResult = await executeSequentialPlan({
        ...baseInput,
        artifactInputBindings: { b: arrayIndexThrows } as unknown as ArtifactInputBindings,
      });
      expect(indexResult).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'b',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: "Artifact input binding 0 for target 'b' could not be read.",
      });

      const bindingProxyGetTrap = new Proxy({ sourceStageId: 'a' }, {
        get() {
          throw new Error('binding get failed');
        },
      });
      const proxyGetResult = await executeSequentialPlan({
        ...baseInput,
        artifactInputBindings: { b: [bindingProxyGetTrap] },
      });
      expect(proxyGetResult).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'b',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: "Artifact input binding 0 for target 'b' sourceStageId could not be read.",
      });

      const sourceGetterThrows = {};
      Object.defineProperty(sourceGetterThrows, 'sourceStageId', {
        enumerable: true,
        get() {
          throw new Error('source getter failed');
        },
      });
      const sourceGetterResult = await executeSequentialPlan({
        ...baseInput,
        artifactInputBindings: { b: [sourceGetterThrows] } as unknown as ArtifactInputBindings,
      });
      expect(sourceGetterResult).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'b',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: "Artifact input binding 0 for target 'b' sourceStageId could not be read.",
      });
    });

    it('rejects symbol keys, accepts numeric keys as strings, and ignores inherited properties', async () => {
      const symbolBindings = { b: [{ sourceStageId: 'a' }] } as Record<string | symbol, unknown>;
      symbolBindings[Symbol('x')] = [];
      const symbolResult = await executeSequentialPlan({
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        ],
        executors: { work: async () => ({ status: 'SUCCEEDED', artifacts: [] }) },
        artifactInputBindings: symbolBindings as ArtifactInputBindings,
      });
      expect(symbolResult).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'unknown',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: 'Artifact input bindings must not contain symbol keys.',
      });

      const numericInputs: StageExecutionInput[] = [];
      const numericResult = await executeSequentialPlan({
        plan: {
          stages: [
            { stageId: '0', upstreams: [] },
            { stageId: '1', upstreams: ['0'] },
          ],
        },
        stageDefinitions: [
          { stageId: '0', stageKind: 'work', dependsOn: [] },
          { stageId: '1', stageKind: 'work', dependsOn: [] },
        ],
        executors: {
          work: async (input) => {
            numericInputs.push(input);
            return input.stageId === '0'
              ? { status: 'SUCCEEDED', artifacts: [{ artifactId: 'zero', artifactKind: 'kind', uri: 'uri' }] }
              : { status: 'SUCCEEDED', artifacts: [] };
          },
        },
        artifactInputBindings: { 1: [{ sourceStageId: '0' }] },
      });
      expect(numericResult.status).toBe('SUCCEEDED');
      expect(numericInputs[1]?.providedArtifacts?.[0]?.artifactId).toBe('zero');

      const inherited = Object.create({ b: [{ sourceStageId: 'missing' }] }) as Record<string, unknown>;
      const inheritedResult = await executeSequentialPlan({
        plan: { stages: [{ stageId: 'b', upstreams: [] }] },
        stageDefinitions: [{ stageId: 'b', stageKind: 'work', dependsOn: [] }],
        executors: { work: async () => ({ status: 'SUCCEEDED', artifacts: [] }) },
        artifactInputBindings: inherited as ArtifactInputBindings,
      });
      expect(inheritedResult.status).toBe('SUCCEEDED');
    });

    it('treats a real own __proto__ property as an ordinary target key', async () => {
      const bindings = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(bindings, '__proto__', {
        enumerable: true,
        value: [],
      });

      const result = await executeSequentialPlan({
        plan: { stages: [{ stageId: '__proto__', upstreams: [] }] },
        stageDefinitions: [{ stageId: '__proto__', stageKind: 'work', dependsOn: [] }],
        executors: { work: async () => ({ status: 'SUCCEEDED', artifacts: [] }) },
        artifactInputBindings: bindings as ArtifactInputBindings,
      });

      expect(result).toEqual({
        status: 'SUCCEEDED',
        completedStages: [{ stageId: '__proto__', artifacts: [] }],
      });
    });

    it('uses ExecutionPlan upstreams instead of StageDefinition dependsOn for binding validity', async () => {
      const acceptedInputs: StageExecutionInput[] = [];
      const accepted = await executeSequentialPlan({
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: [] },
        ],
        executors: {
          work: async (input) => {
            acceptedInputs.push(input);
            return input.stageId === 'a'
              ? { status: 'SUCCEEDED', artifacts: [{ artifactId: 'a-out', artifactKind: 'kind', uri: 'uri' }] }
              : { status: 'SUCCEEDED', artifacts: [] };
          },
        },
        artifactInputBindings: { b: [{ sourceStageId: 'a' }] },
      });
      expect(accepted.status).toBe('SUCCEEDED');
      expect(acceptedInputs[1]?.providedArtifacts?.[0]?.artifactId).toBe('a-out');

      let rejectedCalls = 0;
      const rejected = await executeSequentialPlan({
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: [] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        ],
        executors: {
          work: async () => {
            rejectedCalls += 1;
            return { status: 'SUCCEEDED', artifacts: [] };
          },
        },
        artifactInputBindings: { b: [{ sourceStageId: 'a' }] },
      });
      expect(rejected).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'b',
        reason: 'INVALID_ARTIFACT_BINDINGS',
        details: "Artifact input binding for target 'b' references non-upstream source 'a'.",
      });
      expect(rejectedCalls).toBe(0);
    });

    it('uses a detached normalized binding snapshot after source execution mutates caller input', async () => {
      const bindingObject = { sourceStageId: 'a' };
      const targetArray = [bindingObject];
      const bindings: Record<string, typeof targetArray> = { b: targetArray };
      const receivedInputs: StageExecutionInput[] = [];

      const result = await executeSequentialPlan({
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
        ],
        executors: {
          work: async (input) => {
            receivedInputs.push(input);
            if (input.stageId === 'a') {
              bindings.b = [];
              targetArray.length = 0;
              targetArray.push({ sourceStageId: 'b' });
              bindingObject.sourceStageId = 'b';
              return { status: 'SUCCEEDED', artifacts: [{ artifactId: 'a-out', artifactKind: 'kind', uri: 'uri' }] };
            }
            return { status: 'SUCCEEDED', artifacts: [] };
          },
        },
        artifactInputBindings: bindings,
      });

      expect(result.status).toBe('SUCCEEDED');
      expect(receivedInputs[1]?.providedArtifacts).toEqual([
        { artifactId: 'a-out', artifactKind: 'kind', uri: 'uri' },
      ]);
    });

    it('preserves plan source order and RFC-0009 artifact order while stripping extra fields', async () => {
      const receivedInputs: StageExecutionInput[] = [];
      const artifactWithExtraField = {
        artifactId: 'b-1',
        artifactKind: 'kind',
        uri: 'uri-b-1',
        ignored: 'nope',
      };

      const result = await executeSequentialPlan({
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: [] },
            { stageId: 'c', upstreams: ['a', 'b'] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: [] },
          { stageId: 'c', stageKind: 'work', dependsOn: [] },
        ],
        executors: {
          work: async (input) => {
            receivedInputs.push(input);
            if (input.stageId === 'a') {
              return {
                status: 'SUCCEEDED',
                artifacts: [
                  { artifactId: 'a-1', artifactKind: 'kind', uri: 'uri-a-1' },
                  { artifactId: 'a-2', artifactKind: 'kind', uri: 'uri-a-2' },
                ],
              };
            }
            if (input.stageId === 'b') {
              return { status: 'SUCCEEDED', artifacts: [artifactWithExtraField] };
            }
            return { status: 'SUCCEEDED', artifacts: [] };
          },
        },
        artifactInputBindings: { c: [{ sourceStageId: 'b' }, { sourceStageId: 'a' }] },
      });

      expect(result.status).toBe('SUCCEEDED');
      expect(receivedInputs[2]?.providedArtifacts).toEqual([
        { artifactId: 'a-1', artifactKind: 'kind', uri: 'uri-a-1' },
        { artifactId: 'a-2', artifactKind: 'kind', uri: 'uri-a-2' },
        { artifactId: 'b-1', artifactKind: 'kind', uri: 'uri-b-1' },
      ]);
      expect(receivedInputs[2]?.providedArtifacts?.[2]).not.toBe(artifactWithExtraField);
      expect(Object.keys(receivedInputs[2]?.providedArtifacts?.[2] ?? {})).toEqual([
        'artifactId',
        'artifactKind',
        'uri',
      ]);
    });

    it('fails current target with stable EXECUTOR_FAILED details when a bound source is missing at runtime', async () => {
      const result = await executeSequentialPlan({
        plan: {
          stages: [
            { stageId: 'b', upstreams: ['a'] },
            { stageId: 'a', upstreams: [] },
          ],
        },
        stageDefinitions: [
          { stageId: 'a', stageKind: 'work', dependsOn: [] },
          { stageId: 'b', stageKind: 'work', dependsOn: [] },
        ],
        executors: {
          work: async () => ({ status: 'SUCCEEDED', artifacts: [] }),
        },
        artifactInputBindings: { b: [{ sourceStageId: 'a' }] },
      });

      expect(result).toEqual({
        status: 'FAILED',
        completedStages: [],
        failedStageId: 'b',
        reason: 'EXECUTOR_FAILED',
        details: 'Required upstream source artifact not available.',
      });
    });
    it('provides shallow copies of artifacts, not executor objects', async () => {
      const defs: StageDefinition[] = [
        { stageId: 'a', stageKind: 'work', dependsOn: [] },
        { stageId: 'b', stageKind: 'work', dependsOn: ['a'] },
      ];

      const executorArtifact = {
        artifactId: 'out-a',
        artifactKind: 'type',
        uri: 'uri-a',
      };

      const receivedInputs: StageExecutionInput[] = [];
      const executor: StageExecutor = async (input: StageExecutionInput) => {
        receivedInputs.push(input);
        if (input.stageId === 'a') {
          return {
            status: 'SUCCEEDED',
            artifacts: [executorArtifact],
          };
        }
        return { status: 'SUCCEEDED', artifacts: [] };
      };

      const input: SequentialExecutionInput = {
        plan: {
          stages: [
            { stageId: 'a', upstreams: [] },
            { stageId: 'b', upstreams: ['a'] },
          ],
        },
        stageDefinitions: defs,
        executors: { work: executor },
        artifactInputBindings: {
          b: [{ sourceStageId: 'a' }],
        },
      };

      const result = (await executeSequentialPlan(input)) as any;

      expect(result.status).toBe('SUCCEEDED');
      expect((receivedInputs as any)[1].providedArtifacts).toBeDefined();
      const providedArtifact = (receivedInputs as any)[1].providedArtifacts![0];
      expect(providedArtifact).toEqual(executorArtifact);
      expect(providedArtifact).not.toBe(executorArtifact);
    });
  });
});
