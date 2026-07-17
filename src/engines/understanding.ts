import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import type { EvidenceReference } from "../core/dir.js";
import type { DemoManifest } from "../core/manifest.js";
import type { DecisionRecord } from "../core/decision.js";

export type HeroInteractionCandidate = {
  readonly claim: string;
  readonly source: string;
  readonly confidence: number;
};

export type Understanding = {
  readonly schemaVersion: "0.1";
  readonly problemStatement: string;
  readonly audienceSegments: readonly string[];
  readonly valueProposition: string;
  readonly heroInteractionCandidate: HeroInteractionCandidate;
  readonly evidenceCandidates: readonly EvidenceReference[];
  readonly minimumEvidenceCount: number;
};

const EVIDENCE_KIND_KEYWORDS: ReadonlyArray<readonly [string, EvidenceReference["kind"]]> = [
  ["receipt", "receipt"],
  ["log", "log"],
  ["metric", "metric"],
  ["record", "capture"],
  ["capture", "capture"],
  ["recording", "recording"],
  ["state", "state-change"],
];

function inferEvidenceKind(hint: string): EvidenceReference["kind"] {
  const lower = hint.toLowerCase();
  for (const [keyword, kind] of EVIDENCE_KIND_KEYWORDS) {
    if (lower.includes(keyword)) {
      return kind;
    }
  }
  return "document";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class UnderstandingEngine implements Engine<DemoManifest, Understanding> {
  readonly name = "reference-understanding-engine";
  readonly version = "0.1.0";

  private lastMetrics: EngineMetrics = {
    inputArtifacts: 0,
    outputArtifacts: 0,
    warnings: 0,
  };
  private lastDecisions: readonly DecisionRecord[] = [];

  validate(input: DemoManifest): ValidationResult {
    if (!input.product.problem.trim()) {
      return {
        ok: false,
        issues: [{ path: "product.problem", code: "required", message: "Problem statement is required." }],
      };
    }
    return { ok: true };
  }

  async run(input: DemoManifest, context: EngineContext): Promise<Understanding> {
    const startedAt = context.now();
    const evidenceHints = input.product.evidenceHints ?? [];

    const evidenceCandidates: EvidenceReference[] = evidenceHints.map((hint, index) => ({
      id: `evidence-${slugify(hint)}`,
      kind: inferEvidenceKind(hint),
      claim: `Evidence supports: ${hint}`,
      source: `manifest://product.evidenceHints/${index}`,
      importance: index === 0 ? "critical" : "important",
      verified: false,
    }));

    const decisions: DecisionRecord[] = [];

    let heroInteractionCandidate: HeroInteractionCandidate;
    if (input.product.heroInteractionHint) {
      heroInteractionCandidate = {
        claim: input.product.heroInteractionHint,
        source: "manifest://product.heroInteractionHint",
        confidence: 0.9,
      };
      decisions.push({
        decisionId: `decision-${context.runId}-hero-candidate`,
        runId: context.runId,
        createdAt: startedAt.toISOString(),
        engine: this.name,
        question: "What is the Hero Interaction candidate?",
        options: [
          { id: "from-hint", label: "Use product.heroInteractionHint verbatim" },
          { id: "from-value-proposition", label: "Derive from valueProposition" },
        ],
        chosenOptionId: "from-hint",
        reason: "An explicit heroInteractionHint was provided in the manifest.",
        confidence: 0.9,
        authority: "engine",
        reversible: true,
      });
    } else {
      heroInteractionCandidate = {
        claim: input.product.valueProposition,
        source: "manifest://product.valueProposition",
        confidence: 0.5,
      };
      decisions.push({
        decisionId: `decision-${context.runId}-hero-candidate`,
        runId: context.runId,
        createdAt: startedAt.toISOString(),
        engine: this.name,
        question: "What is the Hero Interaction candidate?",
        options: [
          { id: "from-hint", label: "Use product.heroInteractionHint verbatim" },
          { id: "from-value-proposition", label: "Derive from valueProposition" },
        ],
        chosenOptionId: "from-value-proposition",
        reason: "No heroInteractionHint was present; falling back to the value proposition.",
        confidence: 0.5,
        authority: "engine",
        reversible: true,
      });
    }

    const understanding: Understanding = {
      schemaVersion: "0.1",
      problemStatement: input.product.problem,
      audienceSegments: input.product.audience,
      valueProposition: input.product.valueProposition,
      heroInteractionCandidate,
      evidenceCandidates,
      minimumEvidenceCount: input.constraints?.minimumEvidenceCount ?? 1,
    };

    this.lastMetrics = {
      startedAt: startedAt.toISOString(),
      completedAt: context.now().toISOString(),
      inputArtifacts: 1,
      outputArtifacts: 1,
      warnings: evidenceCandidates.length < understanding.minimumEvidenceCount ? 1 : 0,
    };
    this.lastDecisions = decisions;

    return understanding;
  }

  decisionsFromLastRun(): readonly DecisionRecord[] {
    return this.lastDecisions;
  }

  verify(output: Understanding): VerificationResult {
    if (!output.heroInteractionCandidate.claim.trim()) {
      return {
        ok: false,
        issues: [
          {
            path: "heroInteractionCandidate.claim",
            code: "empty",
            message: "Hero Interaction candidate must have a claim.",
          },
        ],
      };
    }
    return { ok: true, score: output.heroInteractionCandidate.confidence };
  }

  metrics(): EngineMetrics {
    return this.lastMetrics;
  }
}
