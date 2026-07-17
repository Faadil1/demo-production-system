import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import type { EvidenceReference } from "../core/dir.js";
import { clamp01 } from "../core/provenance.js";
import type { DemoManifest } from "../core/manifest.js";
import type { DecisionRecord } from "../core/decision.js";
import type {
  Ambiguity,
  ApprovalRequirement,
  Claim,
  ConfidenceSummary,
  EvidenceCoverage,
  EvidenceItem,
  Fact,
  HeroInteractionCandidate,
  Hypothesis,
  MissingEvidence,
  ProductUnderstanding,
  Risk,
  SelectedHeroInteraction,
  UnderstandingGate,
  UnderstandingGateStatus,
} from "../core/product-understanding.js";

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

function truncateLabel(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Builds the deterministic Product Understanding artifact from a validated manifest.
 * No network access, LLM calls, or probabilistic behavior are involved: every field is
 * derived by fixed rules over the manifest's declared content.
 */
export class UnderstandingEngine implements Engine<DemoManifest, ProductUnderstanding> {
  readonly name = "reference-understanding-engine";
  readonly version = "0.2.0";

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

  async run(input: DemoManifest, context: EngineContext): Promise<ProductUnderstanding> {
    const startedAt = context.now();
    const decisions: DecisionRecord[] = [];
    const decisionId = (suffix: string) => `decision-${context.runId}-${suffix}`;
    const nowIso = () => context.now().toISOString();

    const requiredEvidenceCount = input.constraints?.minimumEvidenceCount ?? 1;
    const evidenceHints = input.product.evidenceHints ?? [];

    // --- Facts: mechanically read, structural manifest declarations. --------------------
    const facts: Fact[] = [
      {
        id: "fact-project-name",
        statement: `Project name is declared as "${input.project.name}".`,
        source: "manifest://project.name",
        sourceType: "manifest",
        confidence: 1,
        verificationStatus: "verified",
      },
      {
        id: "fact-demo-goal",
        statement: `Demo goal is declared as "${input.demo.goal}".`,
        source: "manifest://demo.goal",
        sourceType: "manifest",
        confidence: 1,
        verificationStatus: "verified",
      },
      {
        id: "fact-demo-mode",
        statement: `Demo mode is declared as "${input.demo.mode}".`,
        source: "manifest://demo.mode",
        sourceType: "manifest",
        confidence: 1,
        verificationStatus: "verified",
      },
      {
        id: "fact-target-audience-count",
        statement: `Manifest declares ${input.product.audience.length} target audience segment(s).`,
        source: "manifest://product.audience",
        sourceType: "manifest",
        confidence: 1,
        verificationStatus: "verified",
      },
    ];

    // --- Claims: human-authored assertions about the product; unverified by policy. -----
    const claimProblemId = "claim-problem";
    const claimValuePropositionId = "claim-value-proposition";
    const claimHeroHintId = "claim-hero-interaction-hint";

    const claims: Claim[] = [
      {
        id: claimProblemId,
        statement: input.product.problem,
        source: "manifest://product.problem",
        confidence: 0.6,
        evidenceIds: [],
      },
      {
        id: claimValuePropositionId,
        statement: input.product.valueProposition,
        source: "manifest://product.valueProposition",
        confidence: 0.6,
        evidenceIds: [],
      },
    ];

    decisions.push({
      decisionId: decisionId("claim-classification"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question:
        "Should manifest.product.problem and manifest.product.valueProposition be classified as facts or as claims?",
      options: [
        { id: "fact", label: "Treat as observed fact because the manifest is an authoritative declared source." },
        { id: "claim", label: "Treat as an unverified, human-supplied claim about the product." },
      ],
      chosenOptionId: "claim",
      reason:
        "Constitution Law VIII requires distinguishing verified fact from unverified claim; the manifest author's problem and value-proposition statements describe the world, not the manifest itself, and have not been independently observed.",
      confidence: 1,
      authority: "policy",
      reversible: false,
    });

    // --- Evidence: hints are candidates only, never verified in this reference engine. ---
    const evidenceSupportsClaimId = input.product.heroInteractionHint ? claimHeroHintId : claimValuePropositionId;
    const evidence: EvidenceItem[] = evidenceHints.map((hint, index) => ({
      id: `evidence-${slugify(hint)}`,
      kind: inferEvidenceKind(hint),
      claim: `Evidence supports: ${hint}`,
      source: `manifest://product.evidenceHints/${index}`,
      importance: index === 0 ? "critical" : "important",
      verificationStatus: "unverified",
      supportsClaimIds: [evidenceSupportsClaimId],
    }));

    const missingEvidence: MissingEvidence[] = evidence.map((item) => ({
      id: `missing-${item.id}`,
      requiredClaim: item.claim,
      reason: "Evidence candidate has not been independently verified by a capture adapter.",
      importance: item.importance,
      suggestedAcquisitionMethod: "capture",
    }));

    if (evidence.length < requiredEvidenceCount) {
      missingEvidence.push({
        id: "missing-evidence-shortfall",
        requiredClaim: `At least ${requiredEvidenceCount} evidence item(s) supporting the Hero Interaction.`,
        reason: `Only ${evidence.length} of ${requiredEvidenceCount} required evidence item(s) are available.`,
        importance: "critical",
        suggestedAcquisitionMethod: "capture",
      });
    }

    const criticalCount = evidence.filter((item) => item.importance === "critical").length;
    const verifiedCount = evidence.filter((item) => item.verificationStatus === "verified").length;
    const coverageRatio = requiredEvidenceCount > 0 ? clamp01(evidence.length / requiredEvidenceCount) : 1;
    const evidenceCoverage: EvidenceCoverage = {
      requiredCount: requiredEvidenceCount,
      availableCount: evidence.length,
      verifiedCount,
      criticalCount,
      coverageRatio,
      sufficient: evidence.length >= requiredEvidenceCount,
    };

    decisions.push({
      decisionId: decisionId("evidence-coverage"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "Is available evidence sufficient to support the demo's claims?",
      options: [
        { id: "sufficient", label: "Evidence candidate count meets or exceeds the minimum requirement." },
        { id: "insufficient", label: "Evidence candidate count is below the minimum requirement." },
      ],
      chosenOptionId: evidenceCoverage.sufficient ? "sufficient" : "insufficient",
      reason: `${evidenceCoverage.availableCount} of ${evidenceCoverage.requiredCount} required evidence candidate(s) are present; ${evidenceCoverage.verifiedCount} have been independently verified.`,
      confidence: 1,
      authority: "policy",
      reversible: true,
    });

    // --- Hero Interaction candidates: never silently confirm a hint as truth. -----------
    const hypotheses: Hypothesis[] = [];
    const ambiguities: Ambiguity[] = [];
    const heroInteractionCandidates: HeroInteractionCandidate[] = [];
    let selectedHeroInteraction: SelectedHeroInteraction | null = null;

    if (input.product.heroInteractionHint) {
      claims.push({
        id: claimHeroHintId,
        statement: input.product.heroInteractionHint,
        source: "manifest://product.heroInteractionHint",
        confidence: 0.6,
        evidenceIds: evidence.map((item) => item.id),
      });

      const candidateId = "hero-candidate-from-hint";
      const candidateConfidence = clamp01(0.5 + 0.4 * coverageRatio);
      const candidateRisks = [
        "The Hero Interaction claim is based on a manifest hint and has not been independently observed.",
      ];
      if (!evidenceCoverage.sufficient) {
        candidateRisks.push(
          `Evidence coverage is incomplete (${evidenceCoverage.availableCount}/${evidenceCoverage.requiredCount}).`,
        );
      }

      heroInteractionCandidates.push({
        id: candidateId,
        label: truncateLabel(input.product.heroInteractionHint, 60),
        description: input.product.heroInteractionHint,
        valueDemonstrated: input.product.valueProposition,
        evidenceIds: evidence.map((item) => item.id),
        confidence: candidateConfidence,
        risks: candidateRisks,
        source: "manifest",
      });

      const requiresHumanApproval = input.demo.mode === "assisted" || input.demo.mode === "directed";

      if (evidence.length > 0) {
        selectedHeroInteraction = {
          candidateId,
          reason:
            "Selected provisionally from the single manifest-declared heroInteractionHint, which is the only candidate with supporting evidence requirements.",
          confidence: candidateConfidence,
          authority: "manifest-policy",
          requiresHumanApproval,
        };
      } else {
        ambiguities.push({
          id: "ambiguity-hero-interaction-no-evidence",
          question: "Which evidence would prove the Hero Interaction candidate derived from heroInteractionHint?",
          impact: "A Hero Interaction candidate with zero supporting evidence requirements may not be selected.",
          severity: "high",
          resolutionRequired: true,
        });
      }

      decisions.push({
        decisionId: decisionId("hero-selection"),
        runId: context.runId,
        createdAt: nowIso(),
        engine: this.name,
        question: "Which Hero Interaction candidate should be selected, and provisionally or not?",
        options: [
          { id: "select-provisional", label: "Select the single manifest-hinted candidate provisionally." },
          { id: "defer", label: "Defer selection because the candidate has zero supporting evidence." },
        ],
        chosenOptionId: selectedHeroInteraction ? "select-provisional" : "defer",
        reason: selectedHeroInteraction
          ? "Exactly one candidate exists from an explicit manifest hint and it has supporting evidence requirements, so Design Law 1 is satisfied provisionally."
          : "The candidate derived from heroInteractionHint has zero supporting evidence requirements and must not be selected per RFC-0002 policy.",
        confidence: candidateConfidence,
        authority: "engine",
        reversible: true,
      });
    } else {
      hypotheses.push({
        id: "hypothesis-hero-interaction-from-value-proposition",
        statement: `The value proposition ("${input.product.valueProposition}") may indicate an unstated Hero Interaction.`,
        rationale:
          "No heroInteractionHint was declared in the manifest; the value proposition is the only remaining signal, but it is a hypothesis, not a candidate, until a human or capture adapter confirms it.",
        confidence: 0.3,
        validationRequired: true,
      });

      ambiguities.push({
        id: "ambiguity-no-hero-interaction-hint",
        question: "Which interaction is the demo's Hero Interaction?",
        impact: "No Hero Interaction candidate can be defensibly selected without an explicit manifest hint.",
        severity: "critical",
        resolutionRequired: true,
      });

      decisions.push({
        decisionId: decisionId("hero-selection"),
        runId: context.runId,
        createdAt: nowIso(),
        engine: this.name,
        question: "Which Hero Interaction candidate should be selected, and provisionally or not?",
        options: [
          { id: "select-provisional", label: "Select a candidate derived from the value proposition." },
          { id: "defer", label: "Defer selection because no manifest hint exists." },
        ],
        chosenOptionId: "defer",
        reason:
          "No heroInteractionHint was present in the manifest. Fabricating a candidate from the value proposition alone would violate Constitution Law VIII (claim without observable support).",
        confidence: 0.3,
        authority: "engine",
        reversible: true,
      });
    }

    // --- Risks -----------------------------------------------------------------------
    const risks: Risk[] = [];
    if (heroInteractionCandidates.length === 0) {
      risks.push({
        id: "risk-no-hero-interaction-hint",
        description: "No Hero Interaction candidate is available; the demo cannot yet prove its central claim.",
        category: "scope",
        severity: "critical",
        mitigation: "Provide an explicit product.heroInteractionHint or run a capture-based Understanding Engine.",
      });
    } else {
      risks.push({
        id: "risk-unverified-hero-interaction",
        description: "The selected Hero Interaction claim has not been independently verified.",
        category: "evidence",
        severity: evidenceCoverage.sufficient ? "medium" : "high",
        mitigation: "Verify the Hero Interaction with a capture adapter before treating the demo as proof.",
      });
    }

    // --- Confidence summary ------------------------------------------------------------
    const productUnderstandingConfidence = clamp01(
      input.product.problem.trim() && input.product.valueProposition.trim() && input.product.audience.length > 0
        ? 1
        : 0.5,
    );
    const evidenceCoverageConfidence = clamp01(coverageRatio * (verifiedCount > 0 ? 1 : 0.5));
    const heroInteractionSelectionConfidence = selectedHeroInteraction ? selectedHeroInteraction.confidence : 0;
    const confidence: ConfidenceSummary = {
      overall: clamp01(
        (productUnderstandingConfidence + evidenceCoverageConfidence + heroInteractionSelectionConfidence) / 3,
      ),
      productUnderstanding: productUnderstandingConfidence,
      evidenceCoverage: evidenceCoverageConfidence,
      heroInteractionSelection: heroInteractionSelectionConfidence,
    };

    // --- Approval requirements ----------------------------------------------------------
    const approvalRequirements: ApprovalRequirement[] = [];
    if (selectedHeroInteraction?.requiresHumanApproval) {
      approvalRequirements.push({
        id: "approval-hero-interaction",
        gate: "understanding",
        reason: `The selected Hero Interaction requires human approval because demo.mode is "${input.demo.mode}".`,
        blocking: true,
        status: "pending",
      });
    }

    decisions.push({
      decisionId: decisionId("human-approval"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "Does the selected Hero Interaction require human approval before rendering?",
      options: [
        { id: "required", label: 'Require human approval (demo.mode is "assisted" or "directed").' },
        { id: "not-required", label: 'Do not require human approval (demo.mode is "autonomous").' },
      ],
      chosenOptionId: selectedHeroInteraction?.requiresHumanApproval ? "required" : "not-required",
      reason: `demo.mode is declared as "${input.demo.mode}".`,
      confidence: 1,
      authority: "policy",
      reversible: false,
    });

    // --- Understanding Gate --------------------------------------------------------------
    const gate = computeUnderstandingGate({
      hasProductIdentity:
        input.product.problem.trim().length > 0 &&
        input.product.valueProposition.trim().length > 0 &&
        input.product.audience.length > 0,
      selectedHeroInteraction,
      evidenceCoverage,
      ambiguities,
    });

    decisions.push({
      decisionId: decisionId("understanding-gate"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "What is the Understanding Gate status?",
      options: [
        { id: "pass", label: "Pass: fully understood, evidence verified, no approval outstanding." },
        { id: "conditional", label: "Conditional: structurally understood but evidence unverified or approval pending." },
        { id: "fail", label: "Fail: product identity, Hero Interaction, or minimum evidence cannot be established." },
      ],
      chosenOptionId: gate.status,
      reason:
        gate.blockingReasons.length > 0
          ? gate.blockingReasons.join(" ")
          : gate.warnings.length > 0
            ? gate.warnings.join(" ")
            : "All Understanding Gate requirements are satisfied.",
      confidence: 1,
      authority: "policy",
      reversible: true,
    });

    const understanding: ProductUnderstanding = {
      schemaVersion: "0.2",
      product: {
        name: input.project.name,
        problem: input.product.problem,
        valueProposition: input.product.valueProposition,
        targetAudiences: input.product.audience,
      },
      facts,
      claims,
      hypotheses,
      evidence,
      missingEvidence,
      heroInteractionCandidates,
      selectedHeroInteraction,
      ambiguities,
      risks,
      confidence,
      approvalRequirements,
      evidenceCoverage,
      gate,
    };

    this.lastMetrics = {
      startedAt: startedAt.toISOString(),
      completedAt: context.now().toISOString(),
      inputArtifacts: 1,
      outputArtifacts: 1,
      warnings: gate.warnings.length,
    };
    this.lastDecisions = decisions;

    return understanding;
  }

  decisionsFromLastRun(): readonly DecisionRecord[] {
    return this.lastDecisions;
  }

  verify(output: ProductUnderstanding): VerificationResult {
    if (output.gate.status === "fail") {
      return {
        ok: false,
        issues: output.gate.blockingReasons.map((message) => ({
          path: "gate",
          code: "understanding-gate-failed",
          message,
        })),
      };
    }
    return { ok: true, score: output.confidence.overall };
  }

  metrics(): EngineMetrics {
    return this.lastMetrics;
  }
}

function computeUnderstandingGate(args: {
  readonly hasProductIdentity: boolean;
  readonly selectedHeroInteraction: SelectedHeroInteraction | null;
  readonly evidenceCoverage: EvidenceCoverage;
  readonly ambiguities: readonly Ambiguity[];
}): UnderstandingGate {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const requirementsBeforeRender: string[] = [];

  if (!args.hasProductIdentity) {
    blockingReasons.push(
      "Product problem, value proposition, and at least one target audience are all required.",
    );
  }
  if (!args.selectedHeroInteraction) {
    blockingReasons.push("No Hero Interaction candidate could be selected.");
  }
  if (!args.evidenceCoverage.sufficient) {
    blockingReasons.push(
      `Evidence candidates (${args.evidenceCoverage.availableCount}) do not meet the minimum required (${args.evidenceCoverage.requiredCount}).`,
    );
  }
  const criticalAmbiguity = args.ambiguities.some(
    (ambiguity) => ambiguity.severity === "critical" && ambiguity.resolutionRequired,
  );
  if (criticalAmbiguity) {
    blockingReasons.push("An unresolved critical ambiguity blocks understanding.");
  }

  let status: UnderstandingGateStatus;
  if (blockingReasons.length > 0) {
    status = "fail";
    requirementsBeforeRender.push(...blockingReasons);
  } else {
    const evidenceVerified =
      args.evidenceCoverage.requiredCount > 0 &&
      args.evidenceCoverage.verifiedCount >= args.evidenceCoverage.requiredCount;
    const approvalRequired = args.selectedHeroInteraction?.requiresHumanApproval ?? false;

    if (!evidenceVerified || approvalRequired) {
      status = "conditional";
      if (!evidenceVerified) {
        warnings.push("Evidence has not yet been independently verified.");
        requirementsBeforeRender.push("Verify required evidence before rendering.");
      }
      if (approvalRequired) {
        warnings.push("Human approval is required before rendering.");
        requirementsBeforeRender.push("Obtain human approval for the selected Hero Interaction.");
      }
    } else {
      status = "pass";
    }
  }

  return {
    name: "understanding",
    status,
    blockingReasons,
    warnings,
    requirementsBeforeRender,
  };
}
