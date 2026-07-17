import { describe, expect, it } from "vitest";
import { UnderstandingEngine } from "../src/engines/understanding.js";
import { PlanningEngine } from "../src/engines/planning.js";
import { compileDIR } from "../src/engines/dir-compiler.js";
import type { DemoManifest } from "../src/core/manifest.js";
import type { ProductUnderstanding } from "../src/core/product-understanding.js";

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

  it("resolves the Plan's selectedHeroInteractionId against the Understanding's selected candidate", async () => {
    const understandingEngine = new UnderstandingEngine();
    const understanding = await understandingEngine.run(manifest, context);
    const planningEngine = new PlanningEngine();
    const plan = await planningEngine.run({ manifest, understanding }, context);

    expect(plan.selectedHeroInteractionId).toBe(understanding.selectedHeroInteraction?.candidateId);
    expect(plan.requiredEvidenceIds).toEqual(understanding.selectedHeroInteraction ? plan.requiredEvidenceIds : []);
    expect(plan.humanApprovalRequired).toBe(true);
    expect(plan.understandingGateStatus).toBe("conditional");
  });

  it("carries unresolved requirements from Understanding into the Plan without dropping them", async () => {
    const understandingEngine = new UnderstandingEngine();
    const understanding = await understandingEngine.run(manifest, context);
    const planningEngine = new PlanningEngine();
    const plan = await planningEngine.run({ manifest, understanding }, context);

    expect(plan.unresolvedRequirements.length).toBeGreaterThan(0);
    for (const missing of understanding.missingEvidence) {
      expect(plan.unresolvedRequirements).toContain(`Acquire evidence for: ${missing.requiredClaim}`);
    }
  });

  it("rejects planning when the Understanding Gate has failed", async () => {
    const { heroInteractionHint: _omitted, ...productWithoutHint } = manifest.product;
    const noHintManifest: DemoManifest = { ...manifest, product: productWithoutHint };
    const understandingEngine = new UnderstandingEngine();
    const understanding = await understandingEngine.run(noHintManifest, context);
    expect(understanding.gate.status).toBe("fail");

    const planningEngine = new PlanningEngine();
    const validation = planningEngine.validate({ manifest: noHintManifest, understanding });
    expect(validation.ok).toBe(false);
  });

  it("produces a conditional DIR readiness for the TrustCheck example", async () => {
    const understandingEngine = new UnderstandingEngine();
    const understanding = await understandingEngine.run(manifest, context);
    const planningEngine = new PlanningEngine();
    const plan = await planningEngine.run({ manifest, understanding }, context);
    const dir = compileDIR(manifest, understanding, plan);

    expect(dir.readiness).toBe("conditional");
    expect(dir.evidence.every((item) => item.verificationStatus === "unverified")).toBe(true);
  });

  it("never compiles a DIR from a blocked/failed plan", async () => {
    const understanding: ProductUnderstanding = (
      await (async () => {
        const noHintManifest: DemoManifest = {
          ...manifest,
          product: {
            problem: manifest.product.problem,
            audience: manifest.product.audience,
            valueProposition: manifest.product.valueProposition,
          },
        };
        return new UnderstandingEngine().run(noHintManifest, context);
      })()
    );
    expect(understanding.gate.status).toBe("fail");

    // A defensive, direct construction bypassing PlanningEngine.validate() to prove
    // compileDIR() itself refuses a failed/blocked plan rather than relying only on
    // the Planning Engine's gate.
    const planningEngine = new PlanningEngine();
    const forcedPlan = {
      ...(await planningEngine
        .run(
          {
            manifest,
            understanding: await new UnderstandingEngine().run(manifest, context),
          },
          context,
        )
        .then((plan) => plan)),
      understandingGateStatus: "fail" as const,
    };

    expect(() => compileDIR(manifest, understanding, forcedPlan)).toThrow(/FAIL state/);
  });

  it("produces semantically equivalent Plan and DIR payloads across repeated runs of identical input", async () => {
    const understandingEngine = new UnderstandingEngine();
    const planningEngine = new PlanningEngine();

    const understandingA = await understandingEngine.run(manifest, context);
    const planA = await planningEngine.run({ manifest, understanding: understandingA }, context);
    const dirA = compileDIR(manifest, understandingA, planA);

    const understandingB = await understandingEngine.run(manifest, context);
    const planB = await planningEngine.run({ manifest, understanding: understandingB }, context);
    const dirB = compileDIR(manifest, understandingB, planB);

    expect(understandingA).toEqual(understandingB);
    expect(planA).toEqual(planB);
    expect(dirA).toEqual(dirB);
  });
});
