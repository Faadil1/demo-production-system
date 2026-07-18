import { describe, it, expect } from "vitest";
import {
  createExecutionPlan,
  type StageDefinition,
  type ExecutionPlan,
  type PlanningError,
} from "../src/index.js";

function isPlan(result: ExecutionPlan | PlanningError): result is ExecutionPlan {
  return "stages" in result && !("reason" in result);
}

function isError(result: ExecutionPlan | PlanningError): result is PlanningError {
  return "reason" in result;
}

describe("createExecutionPlan", () => {
  const createPlan = (
    stageDefinitions: StageDefinition[],
    requestedStages: string[]
  ) => createExecutionPlan({ stageDefinitions, requestedStages });

  describe("valid graphs", () => {
    it("accepts a single stage", () => {
      const result = createPlan(
        [{ stageId: "a", stageKind: "render", dependsOn: [] }],
        ["a"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      expect(result.stages).toHaveLength(1);
      expect(result.stages[0]).toEqual({
        stageId: "a",
        upstreams: [],
      });
    });

    it("handles simple two-stage chain (A → B)", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        ],
        ["b"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      expect(p.stages.length).toBe(2);
      if (p.stages.length >= 2) {
        expect(p.stages[0]!.stageId).toBe("a");
        expect(p.stages[1]!.stageId).toBe("b");
        expect(p.stages[1]!.upstreams).toEqual(["a"]);
      }
    });

    it("handles three-stage chain (A → B → C)", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["b"] },
        ],
        ["c"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      expect(p.stages.length).toBe(3);
      expect(p.stages.map((s) => s.stageId)).toEqual(["a", "b", "c"]);
      expect(p.stages[2]?.upstreams).toEqual(["a", "b"]);
    });

    it("auto-includes transitive dependencies", () => {
      const result = createPlan(
        [
          { stageId: "demo", stageKind: "render", dependsOn: [] },
          { stageId: "story", stageKind: "encode", dependsOn: ["demo"] },
          { stageId: "render", stageKind: "render", dependsOn: ["story"] },
        ],
        ["render"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      expect(p.stages.length).toBe(3);
      expect(p.stages.map((s) => s.stageId)).toEqual(["demo", "story", "render"]);
    });

    it("handles branching graph (A → {B, C}, B → D, C → D)", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["a"] },
          { stageId: "d", stageKind: "publish", dependsOn: ["b", "c"] },
        ],
        ["d"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      expect(p.stages.length).toBe(4);
      expect(p.stages[0]?.stageId).toBe("a");
      expect(p.stages[3]?.stageId).toBe("d");
      expect([...( p.stages[3]?.upstreams ?? [])].sort()).toEqual(["a", "b", "c"]);
    });

    it("handles multiple roots with no dependencies", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: [] },
          { stageId: "c", stageKind: "test", dependsOn: [] },
        ],
        ["a", "b", "c"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      expect(p.stages).toHaveLength(3);
      expect(p.stages.map((s) => s.stageId).sort()).toEqual(["a", "b", "c"]);
    });

    it("de-duplicates transitive dependencies in upstreams", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["a"] },
          { stageId: "d", stageKind: "publish", dependsOn: ["b", "c"] },
        ],
        ["d"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      const d = p.stages.find((s) => s.stageId === "d");
      expect(d).toBeDefined();
      if (d) {
        const upstreamSet = new Set(d.upstreams);
        expect(upstreamSet.size).toBe(d.upstreams.length);
      }
    });
  });

  describe("duplicate stage IDs", () => {
    it("rejects duplicate stage IDs", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "a", stageKind: "encode", dependsOn: [] },
        ],
        ["a"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("DUPLICATE_STAGE_ID");
      expect(error.details).toContain("a");
    });
  });

  describe("unknown requested stage", () => {
    it("rejects unknown requested stage", () => {
      const result = createPlan(
        [{ stageId: "a", stageKind: "render", dependsOn: [] }],
        ["b"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("UNKNOWN_REQUESTED_STAGE");
      expect(error.details).toContain("b");
    });

    it("rejects when one of multiple requested stages is unknown", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        ],
        ["a", "unknown"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("UNKNOWN_REQUESTED_STAGE");
    });
  });

  describe("unknown dependencies", () => {
    it("rejects unknown stage dependency", () => {
      const result = createPlan(
        [{ stageId: "a", stageKind: "render", dependsOn: ["missing"] }],
        ["a"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("UNKNOWN_STAGE_DEPENDENCY");
      expect(error.details).toContain("missing");
    });

    it("detects unknown dependency in transitive chain", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["unknown"] },
        ],
        ["c"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("UNKNOWN_STAGE_DEPENDENCY");
    });
  });

  describe("cycles", () => {
    it("rejects simple two-stage cycle (A ↔ B)", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: ["b"] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        ],
        ["a"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("DEPENDENCY_CYCLE");
    });

    it("rejects self-loop", () => {
      const result = createPlan(
        [{ stageId: "a", stageKind: "render", dependsOn: ["a"] }],
        ["a"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("DEPENDENCY_CYCLE");
    });

    it("rejects three-stage cycle (A → B → C → A)", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: ["c"] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["b"] },
        ],
        ["a"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("DEPENDENCY_CYCLE");
    });

    it("rejects diamond DAG with added back-edge (creates cycle)", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: ["e"] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["a"] },
          { stageId: "d", stageKind: "publish", dependsOn: ["b", "c"] },
          { stageId: "e", stageKind: "render", dependsOn: ["d"] },
        ],
        ["d"]
      );

      expect(isError(result)).toBe(true);
      if (!isError(result)) return;
      const error = result;
      expect(error.reason).toBe("DEPENDENCY_CYCLE");
    });

    it("accepts valid diamond DAG without cycle", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["a"] },
          { stageId: "d", stageKind: "publish", dependsOn: ["b", "c"] },
        ],
        ["d"]
      );

      expect(isPlan(result)).toBe(true);
    });

    it("rejects disconnected two-node cycle outside requested closure", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "x", stageKind: "encode", dependsOn: ["y"] },
          { stageId: "y", stageKind: "test", dependsOn: ["x"] },
        ],
        ["a"]
      );

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.reason).toBe("DEPENDENCY_CYCLE");
      }
    });

    it("rejects disconnected self-cycle outside requested closure", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "orphan", stageKind: "encode", dependsOn: ["orphan"] },
        ],
        ["a"]
      );

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.reason).toBe("DEPENDENCY_CYCLE");
      }
    });

    it("accepts valid disconnected acyclic component", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "x", stageKind: "test", dependsOn: [] },
          { stageId: "y", stageKind: "publish", dependsOn: ["x"] },
        ],
        ["b"]
      );

      expect(isPlan(result)).toBe(true);
      if (isPlan(result)) {
        expect(result.stages.length).toBe(2);
        expect(result.stages.map((s) => s.stageId)).toEqual(["a", "b"]);
      }
    });
  });

  describe("determinism", () => {
    it("produces identical plans for identical inputs (byte-equal JSON)", () => {
      const input = {
        stageDefinitions: [
          { stageId: "c", stageKind: "test", dependsOn: ["b"] },
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        ],
        requestedStages: ["c"],
      };

      const result1 = createExecutionPlan(input);
      const result2 = createExecutionPlan(input);

      const json1 = JSON.stringify(result1);
      const json2 = JSON.stringify(result2);

      expect(json1).toBe(json2);
    });

    it("applies lexical ordering for unrelated stages", () => {
      const result = createPlan(
        [
          { stageId: "z", stageKind: "render", dependsOn: [] },
          { stageId: "a", stageKind: "encode", dependsOn: [] },
          { stageId: "m", stageKind: "test", dependsOn: [] },
        ],
        ["z", "a", "m"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      expect(p.stages.map((s) => s.stageId)).toEqual(["a", "m", "z"]);
    });

    it("deterministically orders complex graph with multiple valid topologies", () => {
      const stages: StageDefinition[] = [
        { stageId: "e", stageKind: "render", dependsOn: [] },
        { stageId: "a", stageKind: "encode", dependsOn: [] },
        { stageId: "b", stageKind: "test", dependsOn: ["a"] },
        { stageId: "c", stageKind: "publish", dependsOn: ["a"] },
        { stageId: "d", stageKind: "render", dependsOn: ["b", "c"] },
      ];

      const result1 = createExecutionPlan({
        stageDefinitions: stages,
        requestedStages: ["d", "e"],
      });
      const result2 = createExecutionPlan({
        stageDefinitions: stages,
        requestedStages: ["d", "e"],
      });

      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));

      expect(isPlan(result1)).toBe(true);
      if (isPlan(result1)) {
        expect(result1.stages.map((s) => s.stageId)).toEqual([
          "a",
          "b",
          "c",
          "d",
          "e",
        ]);
      }
    });

    it("produces identical plans for duplicate and de-duplicated requestedStages", () => {
      const input = {
        stageDefinitions: [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        ],
        requestedStages: ["b"],
      };

      const resultWithDuplicates = createExecutionPlan({
        ...input,
        requestedStages: ["b", "b", "a", "b", "a"],
      });
      const resultWithoutDuplicates = createExecutionPlan(input);

      expect(JSON.stringify(resultWithDuplicates)).toBe(
        JSON.stringify(resultWithoutDuplicates)
      );
    });

    it("produces identical plans for permutations of requestedStages", () => {
      const stages: StageDefinition[] = [
        { stageId: "a", stageKind: "render", dependsOn: [] },
        { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        { stageId: "c", stageKind: "test", dependsOn: ["b"] },
      ];

      const result1 = createExecutionPlan({
        stageDefinitions: stages,
        requestedStages: ["b", "c"],
      });
      const result2 = createExecutionPlan({
        stageDefinitions: stages,
        requestedStages: ["c", "b"],
      });

      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });

    it("produces identical plans for permutations of stageDefinitions array", () => {
      const stages1: StageDefinition[] = [
        { stageId: "a", stageKind: "render", dependsOn: [] },
        { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        { stageId: "c", stageKind: "test", dependsOn: ["b"] },
      ];
      const stages2: StageDefinition[] = [
        { stageId: "c", stageKind: "test", dependsOn: ["b"] },
        { stageId: "a", stageKind: "render", dependsOn: [] },
        { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
      ];

      const result1 = createExecutionPlan({
        stageDefinitions: stages1,
        requestedStages: ["c"],
      });
      const result2 = createExecutionPlan({
        stageDefinitions: stages2,
        requestedStages: ["c"],
      });

      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });

    it("produces identical plans for permutations of dependsOn arrays", () => {
      const stages1: StageDefinition[] = [
        { stageId: "d", stageKind: "publish", dependsOn: ["b", "c"] },
        { stageId: "a", stageKind: "render", dependsOn: [] },
        { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        { stageId: "c", stageKind: "test", dependsOn: ["a"] },
      ];
      const stages2: StageDefinition[] = [
        { stageId: "d", stageKind: "publish", dependsOn: ["c", "b"] },
        { stageId: "a", stageKind: "render", dependsOn: [] },
        { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        { stageId: "c", stageKind: "test", dependsOn: ["a"] },
      ];

      const result1 = createExecutionPlan({
        stageDefinitions: stages1,
        requestedStages: ["d"],
      });
      const result2 = createExecutionPlan({
        stageDefinitions: stages2,
        requestedStages: ["d"],
      });

      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });
  });

  describe("stageKind handling", () => {
    it("accepts arbitrary stageKind values without validation or interpretation", () => {
      const result = createPlan(
        [
          { stageId: "render", stageKind: "remotion-render", dependsOn: [] },
          { stageId: "encode", stageKind: "ffmpeg-encode", dependsOn: ["render"] },
        ],
        ["encode"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      expect(p.stages.length).toBe(2);
      expect(p.stages[0]?.stageId).toBe("render");
    });

    it("does not validate stageKind values (opaque to planner)", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "arbitrary-custom-kind", dependsOn: [] },
          { stageId: "b", stageKind: "", dependsOn: ["a"] },
        ],
        ["b"]
      );

      expect("stages" in result).toBe(true);
    });
  });

  describe("upstreams computation", () => {
    it("includes direct dependencies", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
        ],
        ["b"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      const b = p.stages.find((s) => s.stageId === "b")!;
      expect(b.upstreams).toContain("a");
    });

    it("includes transitive dependencies in upstreams", () => {
      const result = createPlan(
        [
          { stageId: "a", stageKind: "render", dependsOn: [] },
          { stageId: "b", stageKind: "encode", dependsOn: ["a"] },
          { stageId: "c", stageKind: "test", dependsOn: ["b"] },
        ],
        ["c"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      const c = p.stages.find((s) => s.stageId === "c");
      expect(c).toBeDefined();
      if (c) {
        expect([...c.upstreams].sort()).toEqual(["a", "b"]);
      }
    });

    it("sorts upstreams lexically", () => {
      const result = createPlan(
        [
          { stageId: "z", stageKind: "render", dependsOn: [] },
          { stageId: "a", stageKind: "encode", dependsOn: [] },
          { stageId: "m", stageKind: "test", dependsOn: ["z", "a"] },
        ],
        ["m"]
      );

      expect(isPlan(result)).toBe(true);
      if (!isPlan(result)) return;
      const p = result;
      const m = p.stages.find((s) => s.stageId === "m");
      expect(m).toBeDefined();
      if (m) {
        expect(m.upstreams).toEqual(["a", "z"]);
      }
    });
  });
});
