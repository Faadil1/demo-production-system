import { describe, expect, it } from "vitest";
import type {
  DemoIntermediateRepresentation,
  Engine,
  EngineContext,
  ValidationResult,
  VerificationResult,
  EngineMetrics,
} from "../src/index.js";

type Input = { readonly title: string };
type Output = { readonly title: string };

class DeterministicEngine implements Engine<Input, Output> {
  readonly name = "deterministic-reference";
  readonly version = "0.1.0";

  validate(input: Input): ValidationResult {
    return input.title.trim()
      ? { ok: true }
      : {
          ok: false,
          issues: [{ path: "title", code: "required", message: "Title is required." }],
        };
  }

  async run(input: Input, _context: EngineContext): Promise<Output> {
    return { title: input.title.trim() };
  }

  verify(output: Output): VerificationResult {
    return output.title ? { ok: true, score: 1 } : { ok: false, issues: [] };
  }

  metrics(): EngineMetrics {
    return { inputArtifacts: 0, outputArtifacts: 1, warnings: 0 };
  }
}

describe("Engine contract", () => {
  it("supports deterministic validation, execution, and verification", async () => {
    const engine = new DeterministicEngine();
    expect(engine.validate({ title: "TrustCheck" })).toEqual({ ok: true });

    const result = await engine.run(
      { title: " TrustCheck " },
      { runId: "run-1", now: () => new Date("2026-07-17T00:00:00Z") },
    );

    expect(result).toEqual({ title: "TrustCheck" });
    expect(engine.verify(result)).toEqual({ ok: true, score: 1 });
  });
});

describe("DIR invariants", () => {
  it("contains one addressable Hero Interaction", () => {
    const dir: DemoIntermediateRepresentation = {
      schemaVersion: "0.1",
      title: "TrustCheck",
      goal: "prove",
      audience: "technical judges",
      durationSeconds: 20,
      heroInteractionSceneId: "verify",
      acts: [{ id: "proof", purpose: "Prove verification", sceneIds: ["verify"] }],
      scenes: [{
        id: "verify",
        actId: "proof",
        purpose: "Show the receipt becoming independently verified.",
        intent: "prove",
        durationSeconds: 10,
        evidenceIds: ["receipt"],
        isHeroInteraction: true,
        transitionRelation: "resolution",
      }],
      evidence: [{
        id: "receipt",
        kind: "receipt",
        claim: "The receipt signature is valid.",
        source: "capture://receipt-verification",
        importance: "critical",
        verified: true,
      }],
      constraints: {
        noGeneratedUI: true,
        minimumEvidenceCount: 1,
        maximumOnScreenWords: 20,
      },
    };

    expect(dir.scenes.filter((scene) => scene.isHeroInteraction)).toHaveLength(1);
    expect(dir.scenes.some((scene) => scene.id === dir.heroInteractionSceneId)).toBe(true);
  });
});
