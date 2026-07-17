import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import type { DIRAct, DIRScene } from "../core/dir.js";
import type { DemoManifest } from "../core/manifest.js";
import type { ProductUnderstanding, UnderstandingGateStatus } from "../core/product-understanding.js";
import type { DecisionRecord } from "../core/decision.js";

export type Plan = {
  readonly schemaVersion: "0.2";
  readonly title: string;
  readonly goal: "explain" | "convince" | "prove" | "onboard";
  readonly audience: string;
  readonly durationSeconds: number;
  readonly heroInteractionSceneId: string;
  readonly acts: readonly DIRAct[];
  readonly scenes: readonly DIRScene[];
  readonly understandingGateStatus: UnderstandingGateStatus;
  readonly unresolvedRequirements: readonly string[];
  readonly selectedHeroInteractionId: string;
  readonly requiredEvidenceIds: readonly string[];
  readonly humanApprovalRequired: boolean;
};

export type PlanningInput = {
  readonly manifest: DemoManifest;
  readonly understanding: ProductUnderstanding;
};

function splitDuration(total: number): readonly [number, number, number] {
  const opening = Math.max(1, Math.round(total * 0.25));
  const closing = Math.max(1, Math.round(total * 0.25));
  const proof = Math.max(1, total - opening - closing);
  return [opening, proof, closing];
}

function collectUnresolvedRequirements(understanding: ProductUnderstanding): readonly string[] {
  const requirements = new Set<string>();
  for (const requirement of understanding.gate.requirementsBeforeRender) {
    requirements.add(requirement);
  }
  for (const ambiguity of understanding.ambiguities) {
    if (ambiguity.resolutionRequired) {
      requirements.add(`Resolve ambiguity: ${ambiguity.question}`);
    }
  }
  for (const missing of understanding.missingEvidence) {
    requirements.add(`Acquire evidence for: ${missing.requiredClaim}`);
  }
  return Array.from(requirements);
}

export class PlanningEngine implements Engine<PlanningInput, Plan> {
  readonly name = "reference-planning-engine";
  readonly version = "0.2.0";

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

    if (input.understanding.gate.status === "fail") {
      return {
        ok: false,
        issues: [
          {
            path: "understanding.gate",
            code: "understanding-gate-failed",
            message: `Cannot plan from a failed Understanding Gate: ${input.understanding.gate.blockingReasons.join(" ")}`,
          },
        ],
      };
    }

    const selected = input.understanding.selectedHeroInteraction;
    if (!selected) {
      return {
        ok: false,
        issues: [
          {
            path: "understanding.selectedHeroInteraction",
            code: "missing",
            message: "No Hero Interaction has been selected by the Understanding Engine.",
          },
        ],
      };
    }

    const candidate = input.understanding.heroInteractionCandidates.find(
      (item) => item.id === selected.candidateId,
    );
    if (!candidate) {
      return {
        ok: false,
        issues: [
          {
            path: "understanding.selectedHeroInteraction.candidateId",
            code: "unresolved",
            message: `selectedHeroInteraction.candidateId "${selected.candidateId}" does not match any heroInteractionCandidates entry.`,
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

    const selected = understanding.selectedHeroInteraction;
    if (!selected) {
      throw new Error("Planning Engine invariant violated: no Hero Interaction was selected.");
    }
    const candidate = understanding.heroInteractionCandidates.find((item) => item.id === selected.candidateId);
    if (!candidate) {
      throw new Error(
        `Planning Engine invariant violated: candidate "${selected.candidateId}" not found among heroInteractionCandidates.`,
      );
    }

    const acts: DIRAct[] = [
      { id: "opening", purpose: "Establish the problem and audience.", sceneIds: ["context"] },
      { id: "proof", purpose: "Demonstrate the Hero Interaction.", sceneIds: ["hero"] },
      { id: "closing", purpose: "Confirm the value proposition.", sceneIds: ["confirmation"] },
    ];

    const scenes: DIRScene[] = [
      {
        id: "context",
        actId: "opening",
        purpose: `Establish the problem: ${understanding.product.problem}`,
        intent: "explain",
        durationSeconds: openingDuration,
        evidenceIds: [],
        isHeroInteraction: false,
        transitionRelation: "opening",
      },
      {
        id: "hero",
        actId: "proof",
        purpose: candidate.description,
        intent: "prove",
        durationSeconds: proofDuration,
        evidenceIds: candidate.evidenceIds,
        isHeroInteraction: true,
        transitionRelation: "resolution",
      },
      {
        id: "confirmation",
        actId: "closing",
        purpose: `Confirm value: ${understanding.product.valueProposition}`,
        intent: "confirm",
        durationSeconds: closingDuration,
        evidenceIds: [],
        isHeroInteraction: false,
        transitionRelation: "closing",
      },
    ];

    const unresolvedRequirements = collectUnresolvedRequirements(understanding);

    const decisions: DecisionRecord[] = [
      {
        decisionId: `decision-${context.runId}-hero-scene`,
        runId: context.runId,
        createdAt: startedAt.toISOString(),
        engine: this.name,
        question: "Which scene is the addressable Hero Interaction?",
        options: [{ id: "hero", label: "The proof-act scene compiled from the selected Hero Interaction candidate." }],
        chosenOptionId: "hero",
        reason: `Consumed understanding.selectedHeroInteraction.candidateId "${selected.candidateId}" per Design Law 1.`,
        confidence: selected.confidence,
        authority: "engine",
        reversible: true,
      },
      {
        decisionId: `decision-${context.runId}-plan-gate-carryover`,
        runId: context.runId,
        createdAt: startedAt.toISOString(),
        engine: this.name,
        question: "How should the Understanding Gate status and its unresolved requirements be represented in the Plan?",
        options: [
          { id: "carry-over", label: "Record understandingGateStatus and unresolvedRequirements on the Plan." },
          { id: "drop", label: "Drop gate status and unresolved requirements from the Plan." },
        ],
        chosenOptionId: "carry-over",
        reason:
          "Ambiguities and missing evidence must never be silently dropped; the Plan preserves them for downstream inspection and rendering gates.",
        confidence: 1,
        authority: "policy",
        reversible: false,
      },
    ];

    const plan: Plan = {
      schemaVersion: "0.2",
      title: manifest.project.name,
      goal: manifest.demo.goal,
      audience: manifest.demo.audience,
      durationSeconds: manifest.demo.durationSeconds,
      heroInteractionSceneId: "hero",
      acts,
      scenes,
      understandingGateStatus: understanding.gate.status,
      unresolvedRequirements,
      selectedHeroInteractionId: candidate.id,
      requiredEvidenceIds: candidate.evidenceIds,
      humanApprovalRequired: selected.requiresHumanApproval,
    };

    this.lastMetrics = {
      startedAt: startedAt.toISOString(),
      completedAt: context.now().toISOString(),
      inputArtifacts: 1,
      outputArtifacts: 1,
      warnings: unresolvedRequirements.length,
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
