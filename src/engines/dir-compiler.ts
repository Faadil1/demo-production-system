import type { DemoIntermediateRepresentation, DIRReadiness, EvidenceReference } from "../core/dir.js";
import type { DemoManifest } from "../core/manifest.js";
import type { ProductUnderstanding } from "../core/product-understanding.js";
import type { Plan } from "./planning.js";

function readinessFromGateStatus(status: Plan["understandingGateStatus"]): DIRReadiness {
  switch (status) {
    case "pass":
      return "ready";
    case "conditional":
      return "conditional";
    case "fail":
      return "blocked";
  }
}

export function compileDIR(
  manifest: DemoManifest,
  understanding: ProductUnderstanding,
  plan: Plan,
): DemoIntermediateRepresentation {
  if (plan.understandingGateStatus === "fail") {
    throw new Error(
      "DIR compilation refused: the Understanding Gate is in a FAIL state and rendering must not begin.",
    );
  }

  const evidence: EvidenceReference[] = understanding.evidence.map((item) => ({
    id: item.id,
    kind: item.kind,
    claim: item.claim,
    source: item.source,
    importance: item.importance,
    verificationStatus: item.verificationStatus,
  }));

  const dir: DemoIntermediateRepresentation = {
    schemaVersion: "0.2",
    title: plan.title,
    goal: plan.goal,
    audience: plan.audience,
    durationSeconds: plan.durationSeconds,
    heroInteractionSceneId: plan.heroInteractionSceneId,
    acts: plan.acts,
    scenes: plan.scenes,
    evidence,
    constraints: {
      noGeneratedUI: manifest.constraints?.noGeneratedUI ?? true,
      minimumEvidenceCount: understanding.evidenceCoverage.requiredCount,
      maximumOnScreenWords: manifest.constraints?.maximumOnScreenWords ?? 20,
    },
    readiness: readinessFromGateStatus(plan.understandingGateStatus),
  };

  assertDIRInvariants(dir);
  return dir;
}

export function assertDIRInvariants(dir: DemoIntermediateRepresentation): void {
  if (dir.readiness === "blocked") {
    throw new Error("DIR invariant violated: a blocked DIR must never be produced.");
  }

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
