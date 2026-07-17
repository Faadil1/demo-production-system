import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import type { DIRAct, DIRScene } from "../core/dir.js";
import type { DemoManifest } from "../core/manifest.js";
import type { Understanding } from "./understanding.js";
import type { DecisionRecord } from "../core/decision.js";

export type Plan = {
  readonly schemaVersion: "0.1";
  readonly title: string;
  readonly goal: "explain" | "convince" | "prove" | "onboard";
  readonly audience: string;
  readonly durationSeconds: number;
  readonly heroInteractionSceneId: string;
  readonly acts: readonly DIRAct[];
  readonly scenes: readonly DIRScene[];
};

export type PlanningInput = {
  readonly manifest: DemoManifest;
  readonly understanding: Understanding;
};

function splitDuration(total: number): readonly [number, number, number] {
  const opening = Math.max(1, Math.round(total * 0.25));
  const closing = Math.max(1, Math.round(total * 0.25));
  const proof = Math.max(1, total - opening - closing);
  return [opening, proof, closing];
}

export class PlanningEngine implements Engine<PlanningInput, Plan> {
  readonly name = "reference-planning-engine";
  readonly version = "0.1.0";

  private lastMetrics: EngineMetrics = {
    inputArtifacts: 0,
    outputArtifacts: 0,
    warnings: 0,
  };
  private lastDecisions: readonly DecisionRecord[] = [];

  validate(input: PlanningInput): ValidationResult {
    if (input.manifest.demo.durationSeconds < 10) {
      return {
        ok: false,
        issues: [
          {
            path: "demo.durationSeconds",
            code: "too-short",
            message: "Duration must be at least 10 seconds.",
          },
        ],
      };
    }
    return { ok: true };
  }

  async run(input: PlanningInput, context: EngineContext): Promise<Plan> {
    const startedAt = context.now();
    const { manifest, understanding } = input;
    const [openingDuration, proofDuration, closingDuration] = splitDuration(
      manifest.demo.durationSeconds,
    );

    const acts: DIRAct[] = [
      { id: "opening", purpose: "Establish the problem and audience.", sceneIds: ["context"] },
      { id: "proof", purpose: "Demonstrate the Hero Interaction.", sceneIds: ["hero"] },
      { id: "closing", purpose: "Confirm the value proposition.", sceneIds: ["confirmation"] },
    ];

    const scenes: DIRScene[] = [
      {
        id: "context",
        actId: "opening",
        purpose: `Establish the problem: ${understanding.problemStatement}`,
        intent: "explain",
        durationSeconds: openingDuration,
        evidenceIds: [],
        isHeroInteraction: false,
        transitionRelation: "opening",
      },
      {
        id: "hero",
        actId: "proof",
        purpose: understanding.heroInteractionCandidate.claim,
        intent: "prove",
        durationSeconds: proofDuration,
        evidenceIds: understanding.evidenceCandidates.map((evidence) => evidence.id),
        isHeroInteraction: true,
        transitionRelation: "resolution",
      },
      {
        id: "confirmation",
        actId: "closing",
        purpose: `Confirm value: ${understanding.valueProposition}`,
        intent: "confirm",
        durationSeconds: closingDuration,
        evidenceIds: [],
        isHeroInteraction: false,
        transitionRelation: "closing",
      },
    ];

    const decisions: DecisionRecord[] = [
      {
        decisionId: `decision-${context.runId}-hero-scene`,
        runId: context.runId,
        createdAt: startedAt.toISOString(),
        engine: this.name,
        question: "Which scene is the addressable Hero Interaction?",
        options: [{ id: "hero", label: "The proof-act scene compiled from the Hero Interaction candidate." }],
        chosenOptionId: "hero",
        reason:
          "Exactly one scene must be marked isHeroInteraction per Design Law 1; the proof act carries the candidate.",
        confidence: understanding.heroInteractionCandidate.confidence,
        authority: "engine",
        reversible: true,
      },
    ];

    const plan: Plan = {
      schemaVersion: "0.1",
      title: manifest.project.name,
      goal: manifest.demo.goal,
      audience: manifest.demo.audience,
      durationSeconds: manifest.demo.durationSeconds,
      heroInteractionSceneId: "hero",
      acts,
      scenes,
    };

    this.lastMetrics = {
      startedAt: startedAt.toISOString(),
      completedAt: context.now().toISOString(),
      inputArtifacts: 1,
      outputArtifacts: 1,
      warnings: 0,
    };
    this.lastDecisions = decisions;

    return plan;
  }

  decisionsFromLastRun(): readonly DecisionRecord[] {
    return this.lastDecisions;
  }

  verify(output: Plan): VerificationResult {
    const heroScenes = output.scenes.filter((scene) => scene.isHeroInteraction);
    if (heroScenes.length !== 1) {
      return {
        ok: false,
        issues: [
          {
            path: "scenes",
            code: "hero-interaction-count",
            message: `Expected exactly one Hero Interaction scene, found ${heroScenes.length}.`,
          },
        ],
      };
    }
    return { ok: true, score: 1 };
  }

  metrics(): EngineMetrics {
    return this.lastMetrics;
  }
}
