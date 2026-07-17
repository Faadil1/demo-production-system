import { describe, expect, it } from "vitest";
import { UnderstandingEngine } from "../src/engines/understanding.js";
import { PlanningEngine } from "../src/engines/planning.js";
import { compileDIR } from "../src/engines/dir-compiler.js";
import type { DemoManifest } from "../src/core/manifest.js";

const manifest: DemoManifest = {
  schemaVersion: "0.1",
  project: { name: "TrustCheck" },
  product: {
    problem: "Agents cannot independently verify whether a claimed action occurred.",
    audience: ["hackathon judges"],
    valueProposition: "Produce independently verifiable signed receipts.",
    heroInteractionHint: "Verify a signed receipt.",
    evidenceHints: ["signed receipt", "public verification key", "verification result"],
  },
  demo: { goal: "prove", audience: "technical judges", durationSeconds: 60, mode: "directed" },
  constraints: { minimumEvidenceCount: 3 },
};

const context = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };

describe("UnderstandingEngine", () => {
  it("derives the Hero Interaction candidate from the manifest hint", async () => {
    const engine = new UnderstandingEngine();
    expect(engine.validate(manifest)).toEqual({ ok: true });

    const understanding = await engine.run(manifest, context);

    expect(understanding.heroInteractionCandidate.claim).toBe("Verify a signed receipt.");
    expect(understanding.evidenceCandidates).toHaveLength(3);
    expect(engine.verify(understanding)).toEqual({ ok: true, score: 0.9 });
    expect(engine.decisionsFromLastRun()).toHaveLength(1);
  });

  it("falls back to the value proposition when no hint is present", async () => {
    const engine = new UnderstandingEngine();
    const { heroInteractionHint: _omitted, ...productWithoutHint } = manifest.product;
    const noHintManifest: DemoManifest = {
      ...manifest,
      product: productWithoutHint,
    };

    const understanding = await engine.run(noHintManifest, context);

    expect(understanding.heroInteractionCandidate.claim).toBe(manifest.product.valueProposition);
    expect(understanding.heroInteractionCandidate.confidence).toBe(0.5);
  });
});

describe("PlanningEngine and DIR compiler", () => {
  it("produces a DIR with exactly one addressable Hero Interaction and resolved references", async () => {
    const understandingEngine = new UnderstandingEngine();
    const understanding = await understandingEngine.run(manifest, context);

    const planningEngine = new PlanningEngine();
    const plan = await planningEngine.run({ manifest, understanding }, context);
    expect(planningEngine.verify(plan)).toEqual({ ok: true, score: 1 });

    const dir = compileDIR(manifest, understanding, plan);

    expect(dir.scenes.filter((scene) => scene.isHeroInteraction)).toHaveLength(1);
    expect(dir.scenes.some((scene) => scene.id === dir.heroInteractionSceneId)).toBe(true);
    expect(dir.evidence.length).toBeGreaterThanOrEqual(dir.constraints.minimumEvidenceCount);

    const sceneIds = new Set(dir.scenes.map((scene) => scene.id));
    for (const act of dir.acts) {
      for (const sceneId of act.sceneIds) {
        expect(sceneIds.has(sceneId)).toBe(true);
      }
    }
  });

  it("produces semantically equivalent DIR payloads across repeated runs of identical input", async () => {
    const understandingEngine = new UnderstandingEngine();
    const planningEngine = new PlanningEngine();

    const understandingA = await understandingEngine.run(manifest, context);
    const planA = await planningEngine.run({ manifest, understanding: understandingA }, context);
    const dirA = compileDIR(manifest, understandingA, planA);

    const understandingB = await understandingEngine.run(manifest, context);
    const planB = await planningEngine.run({ manifest, understanding: understandingB }, context);
    const dirB = compileDIR(manifest, understandingB, planB);

    expect(dirA).toEqual(dirB);
  });
});
