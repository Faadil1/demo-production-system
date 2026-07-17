import type { DemoIntermediateRepresentation } from "../core/dir.js";
import type { DemoManifest } from "../core/manifest.js";
import type { Understanding } from "./understanding.js";
import type { Plan } from "./planning.js";

export function compileDIR(
  manifest: DemoManifest,
  understanding: Understanding,
  plan: Plan,
): DemoIntermediateRepresentation {
  const dir: DemoIntermediateRepresentation = {
    schemaVersion: "0.1",
    title: plan.title,
    goal: plan.goal,
    audience: plan.audience,
    durationSeconds: plan.durationSeconds,
    heroInteractionSceneId: plan.heroInteractionSceneId,
    acts: plan.acts,
    scenes: plan.scenes,
    evidence: understanding.evidenceCandidates,
    constraints: {
      noGeneratedUI: manifest.constraints?.noGeneratedUI ?? true,
      minimumEvidenceCount: understanding.minimumEvidenceCount,
      maximumOnScreenWords: manifest.constraints?.maximumOnScreenWords ?? 20,
    },
  };

  assertDIRInvariants(dir);
  return dir;
}

export function assertDIRInvariants(dir: DemoIntermediateRepresentation): void {
  const heroScenes = dir.scenes.filter((scene) => scene.isHeroInteraction);
  if (heroScenes.length !== 1) {
    throw new Error(
      `DIR invariant violated: expected exactly one Hero Interaction scene, found ${heroScenes.length}.`,
    );
  }
  if (heroScenes[0]?.id !== dir.heroInteractionSceneId) {
    throw new Error("DIR invariant violated: heroInteractionSceneId does not match the marked scene.");
  }
  if (dir.evidence.length < 1) {
    throw new Error("DIR invariant violated: at least one evidence requirement is required.");
  }

  const sceneIds = new Set(dir.scenes.map((scene) => scene.id));
  const evidenceIds = new Set(dir.evidence.map((evidence) => evidence.id));
  const actIds = new Set(dir.acts.map((act) => act.id));

  for (const act of dir.acts) {
    for (const sceneId of act.sceneIds) {
      if (!sceneIds.has(sceneId)) {
        throw new Error(`DIR invariant violated: act "${act.id}" references unknown scene "${sceneId}".`);
      }
    }
  }
  for (const scene of dir.scenes) {
    if (!actIds.has(scene.actId)) {
      throw new Error(`DIR invariant violated: scene "${scene.id}" references unknown act "${scene.actId}".`);
    }
    for (const evidenceId of scene.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(
          `DIR invariant violated: scene "${scene.id}" references unknown evidence "${evidenceId}".`,
        );
      }
    }
  }
}
