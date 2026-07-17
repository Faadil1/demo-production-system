import { describe, expect, it } from "vitest";
import { UnderstandingEngine } from "../src/engines/understanding.js";
import type { DemoManifest } from "../src/core/manifest.js";

const baseManifest: DemoManifest = {
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

function withMode(mode: DemoManifest["demo"]["mode"]): DemoManifest {
  return { ...baseManifest, demo: { ...baseManifest.demo, mode } };
}

function withoutHeroHint(): DemoManifest {
  const { heroInteractionHint: _omitted, ...productWithoutHint } = baseManifest.product;
  return { ...baseManifest, product: productWithoutHint };
}

function collectAllConfidenceValues(understanding: Awaited<ReturnType<UnderstandingEngine["run"]>>): number[] {
  const values: number[] = [
    understanding.confidence.overall,
    understanding.confidence.productUnderstanding,
    understanding.confidence.evidenceCoverage,
    understanding.confidence.heroInteractionSelection,
  ];
  for (const fact of understanding.facts) values.push(fact.confidence);
  for (const claim of understanding.claims) values.push(claim.confidence);
  for (const hypothesis of understanding.hypotheses) values.push(hypothesis.confidence);
  for (const candidate of understanding.heroInteractionCandidates) values.push(candidate.confidence);
  if (understanding.selectedHeroInteraction) values.push(understanding.selectedHeroInteraction.confidence);
  return values;
}

describe("Product Understanding contract (RFC-0002)", () => {
  it("does not confuse manifest-derived facts with inferred hypotheses", async () => {
    const understanding = await new UnderstandingEngine().run(withoutHeroHint(), context);

    expect(understanding.facts.length).toBeGreaterThan(0);
    for (const fact of understanding.facts) {
      expect(fact.sourceType).toBe("manifest");
      expect(fact.verificationStatus).toBe("verified");
    }

    expect(understanding.hypotheses.length).toBeGreaterThan(0);
    for (const hypothesis of understanding.hypotheses) {
      expect(hypothesis.validationRequired).toBe(true);
      // Hypotheses must never appear in the facts list, and vice versa.
      expect(understanding.facts.some((fact) => fact.statement === hypothesis.statement)).toBe(false);
    }
  });

  it("keeps evidence hints unverified", async () => {
    const understanding = await new UnderstandingEngine().run(baseManifest, context);

    expect(understanding.evidence).toHaveLength(3);
    for (const item of understanding.evidence) {
      expect(item.verificationStatus).toBe("unverified");
    }
  });

  it("reports evidence coverage as insufficient/verified=0 when nothing is verified", async () => {
    const understanding = await new UnderstandingEngine().run(baseManifest, context);

    expect(understanding.evidenceCoverage.requiredCount).toBe(3);
    expect(understanding.evidenceCoverage.availableCount).toBe(3);
    expect(understanding.evidenceCoverage.verifiedCount).toBe(0);
    expect(understanding.missingEvidence.length).toBeGreaterThan(0);
  });

  it("requires human approval in directed mode", async () => {
    const understanding = await new UnderstandingEngine().run(withMode("directed"), context);
    expect(understanding.selectedHeroInteraction?.requiresHumanApproval).toBe(true);
  });

  it("requires human approval in assisted mode", async () => {
    const understanding = await new UnderstandingEngine().run(withMode("assisted"), context);
    expect(understanding.selectedHeroInteraction?.requiresHumanApproval).toBe(true);
  });

  it("does not require human approval in autonomous mode but still leaves evidence unverified", async () => {
    const understanding = await new UnderstandingEngine().run(withMode("autonomous"), context);

    expect(understanding.selectedHeroInteraction?.requiresHumanApproval).toBe(false);
    expect(understanding.evidenceCoverage.verifiedCount).toBe(0);
    // Documented policy: PASS requires verified evidence, which the reference engine
    // never produces, so autonomous mode still yields a conditional (not passing) gate.
    expect(understanding.gate.status).toBe("conditional");
  });

  it("produces a conditional Understanding Gate for the TrustCheck example", async () => {
    const understanding = await new UnderstandingEngine().run(baseManifest, context);
    expect(understanding.gate.status).toBe("conditional");
    expect(understanding.gate.warnings.length).toBeGreaterThan(0);
    expect(understanding.gate.requirementsBeforeRender.length).toBeGreaterThan(0);
  });

  it("produces a fail / explicit unresolved state when no Hero Interaction hint is present", async () => {
    const understanding = await new UnderstandingEngine().run(withoutHeroHint(), context);

    expect(understanding.heroInteractionCandidates).toHaveLength(0);
    expect(understanding.selectedHeroInteraction).toBeNull();
    expect(understanding.gate.status).toBe("fail");
    expect(understanding.gate.blockingReasons.length).toBeGreaterThan(0);
    expect(understanding.ambiguities.some((ambiguity) => ambiguity.severity === "critical")).toBe(true);
  });

  it("resolves exactly one selected Hero Interaction when a hint and evidence exist", async () => {
    const understanding = await new UnderstandingEngine().run(baseManifest, context);

    expect(understanding.heroInteractionCandidates).toHaveLength(1);
    expect(understanding.selectedHeroInteraction).not.toBeNull();
    expect(understanding.selectedHeroInteraction?.candidateId).toBe(understanding.heroInteractionCandidates[0]?.id);
  });

  it("never selects a Hero Interaction candidate with zero supporting evidence", async () => {
    const { evidenceHints: _omitted, ...productWithoutEvidence } = baseManifest.product;
    const manifestWithoutEvidence: DemoManifest = { ...baseManifest, product: productWithoutEvidence };
    const understanding = await new UnderstandingEngine().run(manifestWithoutEvidence, context);

    expect(understanding.heroInteractionCandidates).toHaveLength(1);
    expect(understanding.heroInteractionCandidates[0]?.evidenceIds).toHaveLength(0);
    expect(understanding.selectedHeroInteraction).toBeNull();
    expect(understanding.gate.status).toBe("fail");
  });

  it("never represents unverified evidence as proven", async () => {
    const understanding = await new UnderstandingEngine().run(baseManifest, context);
    const provenTerms = understanding.evidence.filter((item) => item.verificationStatus === "verified");
    expect(provenTerms).toHaveLength(0);
  });

  it("keeps all confidence values within [0, 1]", async () => {
    const understanding = await new UnderstandingEngine().run(baseManifest, context);
    for (const value of collectAllConfidenceValues(understanding)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across repeated runs of identical input", async () => {
    const engine = new UnderstandingEngine();
    const a = await engine.run(baseManifest, context);
    const b = await engine.run(baseManifest, context);
    expect(a).toEqual(b);
  });

  it("rejects (fails verification) a failed Understanding Gate output", async () => {
    const engine = new UnderstandingEngine();
    const understanding = await engine.run(withoutHeroHint(), context);
    const verification = engine.verify(understanding);
    expect(verification.ok).toBe(false);
  });
});
