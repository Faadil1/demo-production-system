import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import { clamp01 } from "../core/provenance.js";
import { contentHashOf } from "../core/hash.js";
import type {
  BrowserCaptureRunInput,
  BrowserCaptureSelectionPolicy,
  HeroContinuityStatus,
  HeroInteractionSequence,
  HeroNarrativeAuthority,
  HeroVerificationStatus,
  NarrativeArc,
  NarrativeBeat,
  NarrativeBeatKind,
  ProofChain,
  ProofChainStatus,
  RejectedStoryCandidate,
  RejectionReasonCode,
  RendererReadiness,
  RendererReadinessStatus,
  StoryAudience,
  StoryCompilerInput,
  StoryCoverage,
  StoryDecision,
  StoryDurationBudget,
  StoryEvidenceReference,
  StoryGate,
  StoryGateStatus,
  StoryMetrics,
  StoryMode,
  StoryObjective,
  StoryScene,
  StorySequence,
  StorySequenceKind,
  StoryTransitionIntent,
  Storyboard,
} from "../core/story.js";
import {
  DEFAULT_CAPTURE_SELECTION_POLICY,
  DEFAULT_STORY_AUDIENCE,
  MINIMUM_READABLE_SCENE_MS,
  NARRATIVE_ARCS,
  PERSUASIVE_OBJECTIVES,
  classifiedReason,
  isEvidenceEligibleForRole,
} from "../core/story.js";
import type { DemoObservation } from "../core/demo-observation.js";

/**
 * Deterministic RFC-0005 Story Engine reference compiler.
 *
 * Scope note (documented also in docs/implementation/rfc-0005-implementation.md): this
 * reference implementation covers the full v0.1 pipeline shape (normalize → candidates →
 * arc → scenes → sequences → proof chains → duration → coverage → renderer readiness →
 * gate) and every top-level Storyboard invariant that is testable without semantic
 * claim-to-assertion matching. It intentionally uses a simplified, documented candidate
 * generation policy (one scene per selected beat; run-level rather than per-claim
 * assertion linkage for proof-chain eligibility) rather than the full multi-candidate
 * scoring formula in RFC-0005 §20, which the RFC itself describes as "illustrative, not
 * final" and leaves to implementation. See the Known Limitations section of the
 * implementation doc for the precise boundary.
 */

const SEQUENCE_KIND_FOR_BEAT: Record<NarrativeBeatKind, StorySequenceKind> = {
  hook: "opening",
  "audience-context": "context",
  problem: "problem",
  consequence: "problem",
  "current-state": "problem",
  goal: "problem",
  "product-introduction": "context",
  mechanism: "context",
  "interaction-start": "demonstration",
  "interaction-progress": "demonstration",
  "interaction-complete": "demonstration",
  proof: "proof",
  comparison: "demonstration",
  result: "outcome",
  impact: "outcome",
  trust: "outcome",
  limitation: "outcome",
  "next-step": "conclusion",
  "call-to-action": "conclusion",
};

const SEQUENCE_ORDER: readonly StorySequenceKind[] = [
  "opening",
  "context",
  "problem",
  "mechanism",
  "demonstration",
  "proof",
  "outcome",
  "conclusion",
];

function evRef(args: {
  readonly idSuffix: string;
  readonly sourceType: StoryEvidenceReference["sourceType"];
  readonly sourceArtifactId: string;
  readonly sourceItemId: string;
  readonly sourceRunId: string;
  readonly verificationStatus: StoryEvidenceReference["verificationStatus"];
  readonly role: StoryEvidenceReference["role"];
}): StoryEvidenceReference {
  return {
    id: `evref-${args.idSuffix}`,
    sourceType: args.sourceType,
    sourceArtifactId: args.sourceArtifactId,
    sourceItemId: args.sourceItemId,
    sourceRunId: args.sourceRunId,
    verificationStatus: args.verificationStatus,
    role: args.role,
  };
}

// ---------------------------------------------------------------------------
// §26 storyMode resolution + capture selection policy
// ---------------------------------------------------------------------------

function resolveStoryMode(input: StoryCompilerInput): StoryMode {
  const modeConstraint = input.constraints.find((c) => c.kind === "mode");
  return modeConstraint ? "diagnostic" : "promotional";
}

type CaptureSelection = {
  readonly authoritative: BrowserCaptureRunInput | null;
  readonly conflicts: readonly string[];
  readonly unresolvedCriticalConflict: boolean;
};

function selectAuthoritativeCapture(
  captures: readonly BrowserCaptureRunInput[],
  policy: BrowserCaptureSelectionPolicy,
): CaptureSelection {
  if (captures.length === 0) {
    return { authoritative: null, conflicts: [], unresolvedCriticalConflict: false };
  }

  if (policy.authoritativeRunId) {
    const found = captures.find((c) => c.runId === policy.authoritativeRunId);
    if (found) {
      return { authoritative: found, conflicts: [], unresolvedCriticalConflict: false };
    }
  }

  // Detect disagreement: two runs whose gate status differs materially on the same
  // capturePlanId/targetId pairing (a documented simplification of "disagree on the same
  // claim" — see implementation doc — since BrowserCaptureResult carries no per-claim id).
  const byTarget = new Map<string, BrowserCaptureRunInput[]>();
  for (const c of captures) {
    const key = `${c.result.capturePlanId}::${c.result.targetId}`;
    const list = byTarget.get(key) ?? [];
    list.push(c);
    byTarget.set(key, list);
  }
  let hasConflict = false;
  const conflictNotes: string[] = [];
  for (const [key, list] of byTarget) {
    const statuses = new Set(list.map((c) => c.result.gate.status));
    if (list.length > 1 && statuses.size > 1) {
      hasConflict = true;
      conflictNotes.push(`Capture runs for "${key}" disagree on gate status: ${[...statuses].sort().join(", ")}.`);
    }
  }

  if (policy.fallback === "reject-conflict" && hasConflict) {
    return { authoritative: null, conflicts: conflictNotes, unresolvedCriticalConflict: true };
  }

  let authoritative: BrowserCaptureRunInput;
  if (policy.fallback === "highest-gate-status") {
    const rank = { pass: 2, conditional: 1, fail: 0 } as const;
    authoritative = [...captures].sort((a, b) => {
      const diff = rank[b.result.gate.status] - rank[a.result.gate.status];
      if (diff !== 0) return diff;
      return a.runId.localeCompare(b.runId);
    })[0]!;
  } else {
    // "latest-captured-at" (also the default when policy omitted, §26 rule 3).
    authoritative = [...captures].sort((a, b) => {
      const diff = new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
      if (diff !== 0) return diff;
      return a.runId.localeCompare(b.runId);
    })[0]!;
  }

  return {
    authoritative,
    conflicts: conflictNotes,
    unresolvedCriticalConflict: false,
  };
}

// ---------------------------------------------------------------------------
// §16 Hero Interaction authority + verification
// ---------------------------------------------------------------------------

type HeroChain = {
  readonly start: DemoObservation;
  readonly complete: DemoObservation;
  readonly proof: DemoObservation | null;
  readonly result: DemoObservation | null;
};

function findHeroChain(observations: readonly DemoObservation[]): HeroChain | null {
  const starts = [...observations.filter((o) => o.kind === "interaction-start")].sort(
    (a, b) => a.startSeconds - b.startSeconds,
  );
  for (const start of starts) {
    const complete = observations
      .filter((o) => (o.kind === "interaction-complete" || o.kind === "state-change") && o.startSeconds >= start.startSeconds)
      .sort((a, b) => a.startSeconds - b.startSeconds)[0];
    if (!complete) continue;
    const proof =
      observations
        .filter((o) => o.kind === "proof-visible" && o.startSeconds >= complete.startSeconds)
        .sort((a, b) => a.startSeconds - b.startSeconds)[0] ?? null;
    const result =
      observations
        .filter((o) => o.kind === "result-visible" && o.startSeconds >= complete.startSeconds)
        .sort((a, b) => a.startSeconds - b.startSeconds)[0] ?? null;
    return { start, complete, proof, result };
  }
  return null;
}

type HeroResolution = {
  readonly sourceHeroInteractionId: string | null;
  readonly narrativeAuthority: HeroNarrativeAuthority | null;
  readonly chain: HeroChain | null;
  readonly verificationStatus: HeroVerificationStatus;
  readonly continuityStatus: HeroContinuityStatus;
  readonly confidence: number;
};

function resolveHeroInteraction(input: StoryCompilerInput, authoritative: BrowserCaptureRunInput | null): HeroResolution {
  const selected = input.productUnderstanding.selectedHeroInteraction;
  let sourceHeroInteractionId: string | null = null;
  let narrativeAuthority: HeroNarrativeAuthority | null = null;

  if (selected && selected.authority === "human") {
    sourceHeroInteractionId = selected.candidateId;
    narrativeAuthority = "human-selected";
  } else if (input.existingDemoAnalysis?.heroInteraction.status === "identified") {
    sourceHeroInteractionId = input.existingDemoAnalysis.heroInteraction.sourceObservationIds[0] ?? "analysis-hero";
    narrativeAuthority = "analysis-derived";
  } else if (selected) {
    // manifest-policy authority selection still identifies a hero narratively, but is not
    // "human-selected"; RFC-0005 §16 treats non-human RFC-0002 authority the same as "no
    // valid explicit human-authority selection" for narrativeAuthority purposes.
    sourceHeroInteractionId = selected.candidateId;
    narrativeAuthority = "policy-selected";
  }

  if (!sourceHeroInteractionId) {
    return {
      sourceHeroInteractionId: null,
      narrativeAuthority: null,
      chain: null,
      verificationStatus: "unverifiable",
      continuityStatus: "broken",
      confidence: 0,
    };
  }

  const chain = authoritative ? findHeroChain(authoritative.result.observationTimeline.observations) : null;

  let verificationStatus: HeroVerificationStatus;
  let continuityStatus: HeroContinuityStatus;
  let confidence: number;
  if (!chain) {
    verificationStatus = "unverifiable";
    continuityStatus = "broken";
    confidence = 0;
  } else {
    const anyVerified = [chain.start, chain.complete, chain.proof, chain.result].some(
      (o) => o?.verificationStatus === "verified",
    );
    verificationStatus = anyVerified ? "verified" : "partially-verified";
    continuityStatus = chain.proof || chain.result ? "complete" : "partial";
    confidence = Math.min(chain.start.confidence, chain.complete.confidence, chain.proof?.confidence ?? chain.complete.confidence);
  }

  return { sourceHeroInteractionId, narrativeAuthority, chain, verificationStatus, continuityStatus, confidence };
}

// ---------------------------------------------------------------------------
// §19 candidate beat generation (documented simplified rule set — see file header)
// ---------------------------------------------------------------------------

type BeatCandidateResult = {
  readonly beats: readonly NarrativeBeat[];
  readonly rejected: readonly RejectedStoryCandidate[];
};

function generateCandidateBeats(
  input: StoryCompilerInput,
  storyMode: StoryMode,
  hero: HeroResolution,
  authoritative: BrowserCaptureRunInput | null,
): BeatCandidateResult {
  const beats: NarrativeBeat[] = [];
  const rejected: RejectedStoryCandidate[] = [];
  const pu = input.productUnderstanding;

  const allowUnverifiedImpact = input.constraints.find((c) => c.kind === "allow-unverified-impact");

  function reject(
    candidateType: "beat",
    idSuffix: string,
    snapshot: unknown,
    reasonCode: RejectionReasonCode,
    explanation: string,
  ): void {
    rejected.push({
      id: `rejected-${idSuffix}`,
      candidateType,
      candidateSnapshot: snapshot,
      reasonCode,
      explanation,
      conflictingWithIds: [],
      replacedByIds: [],
    });
  }

  // problem
  {
    const facts = [...pu.facts]
      .filter((f) => f.verificationStatus === "verified" || f.verificationStatus === "partially-verified")
      .sort((a, b) => a.id.localeCompare(b.id));
    const snapshot = { kind: "problem", problem: pu.product.problem };
    if (pu.product.problem.trim() && facts.length > 0) {
      const allVerified = facts.every((f) => f.verificationStatus === "verified");
      const confidence = clamp01(facts.reduce((s, f) => s + f.confidence, 0) / facts.length);
      beats.push({
        schemaVersion: "0.1",
        id: "beat-problem",
        kind: "problem",
        purpose: `Establish the problem: ${pu.product.problem}`,
        audienceTakeaway: `The audience understands the problem "${pu.product.problem}" is real and evidenced.`,
        sourceClaimIds: [],
        sourceFactIds: facts.map((f) => f.id),
        evidenceRefs: facts.map((f) =>
          evRef({
            idSuffix: `problem-${f.id}`,
            sourceType: "understanding-evidence",
            sourceArtifactId: "product-understanding",
            sourceItemId: f.id,
            sourceRunId: "n/a",
            verificationStatus: f.verificationStatus,
            role: "context",
          }),
        ),
        requiredObservationIds: [],
        confidence,
        importance: "critical",
        verificationStatus: allVerified ? "verified" : "partially-verified",
        uncertaintyNotes: allVerified ? [] : ["Not every supporting fact is fully verified."],
        mustAppear: true,
        dependencies: [],
        conflictsWith: [],
      });
    } else {
      reject("beat", "problem", snapshot, "unsupported", "No verified/partially-verified Fact backs the stated problem.");
    }
  }

  // product-introduction (evidence: product identity itself, always available per §6)
  if (pu.product.name.trim()) {
    beats.push({
      schemaVersion: "0.1",
      id: "beat-product-introduction",
      kind: "product-introduction",
      purpose: `Introduce ${pu.product.name}.`,
      audienceTakeaway: `The audience knows what ${pu.product.name} is and its value proposition.`,
      sourceClaimIds: [],
      sourceFactIds: [],
      evidenceRefs: [
        evRef({
          idSuffix: "product-identity",
          sourceType: "understanding-evidence",
          sourceArtifactId: "product-understanding",
          sourceItemId: "product-identity",
          sourceRunId: "n/a",
          verificationStatus: "verified",
          role: "context",
        }),
      ],
      requiredObservationIds: [],
      confidence: 0.9,
      importance: "important",
      verificationStatus: "verified",
      uncertaintyNotes: [],
      mustAppear: true,
      dependencies: [],
      conflictsWith: [],
    });
  } else {
    reject("beat", "product-introduction", { kind: "product-introduction" }, "unsupported", "product.name is empty.");
  }

  // interaction-start / interaction-complete / proof / result — from Hero Interaction chain
  if (hero.chain && authoritative) {
    const runId = authoritative.runId;
    const artifactId = authoritative.artifactId;

    beats.push(
      makeInteractionBeat("interaction-start", hero.chain.start, runId, artifactId, "beat-interaction-start"),
      makeInteractionBeat("interaction-complete", hero.chain.complete, runId, artifactId, "beat-interaction-complete"),
    );

    // proof: prefer a passed assertion with linked artifacts (§8 eligibility); fall back
    // to the proof-visible observation alone (partially-verified, context-only proof).
    const passedAssertions = authoritative.result.assertions.filter(
      (a) => a.status === "passed" && a.relatedArtifactIds.length > 0,
    );
    if (passedAssertions.length > 0) {
      const a = [...passedAssertions].sort((x, y) => x.assertionId.localeCompare(y.assertionId))[0]!;
      beats.push({
        schemaVersion: "0.1",
        id: "beat-proof",
        kind: "proof",
        purpose: "Substantiate the Hero Interaction with a passed assertion.",
        audienceTakeaway: "The audience sees verifiable proof the interaction worked.",
        sourceClaimIds: [],
        sourceFactIds: [],
        evidenceRefs: [
          evRef({
            idSuffix: `proof-${a.assertionId}`,
            sourceType: "browser-assertion",
            sourceArtifactId: artifactId,
            sourceItemId: a.assertionId,
            sourceRunId: runId,
            verificationStatus: "verified",
            role: "proof",
          }),
        ],
        requiredObservationIds: hero.chain.proof ? [hero.chain.proof.id] : [],
        confidence: 0.85,
        importance: "critical",
        verificationStatus: "verified",
        uncertaintyNotes: [],
        mustAppear: true,
        dependencies: ["beat-interaction-complete"],
        conflictsWith: [],
      });
    } else if (hero.chain.proof) {
      reject(
        "beat",
        "proof",
        { kind: "proof", observationId: hero.chain.proof.id },
        "unsupported",
        "No passed browser assertion with a linked artifact exists; a proof-visible observation alone cannot satisfy §8 proof eligibility.",
      );
    } else {
      reject("beat", "proof", { kind: "proof" }, "unsupported", "No proof-visible observation or passed assertion exists.");
    }

    if (hero.chain.result) {
      beats.push(
        makeInteractionBeat("result", hero.chain.result, runId, artifactId, "beat-result", "beat-interaction-complete"),
      );
    } else {
      reject("beat", "result", { kind: "result" }, "dependency-missing", "No result-visible observation exists after interaction-complete.");
    }
  } else {
    reject("beat", "interaction-chain", { kind: "interaction-start/complete/proof/result" }, "unsupported", "No authoritative browser capture / Hero Interaction chain is available.");
  }

  // limitation — failed assertions in the authoritative run
  if (authoritative) {
    const failed = authoritative.result.assertions.filter((a) => a.status === "failed");
    if (failed.length > 0) {
      const candidate: NarrativeBeat = {
        schemaVersion: "0.1",
        id: "beat-limitation",
        kind: "limitation",
        purpose: "Disclose an observed failure.",
        audienceTakeaway: "The audience is honestly told about a known gap.",
        sourceClaimIds: [],
        sourceFactIds: [],
        evidenceRefs: failed.map((a) =>
          evRef({
            idSuffix: `limitation-${a.assertionId}`,
            sourceType: "browser-assertion",
            sourceArtifactId: authoritative.artifactId,
            sourceItemId: a.assertionId,
            sourceRunId: authoritative.runId,
            verificationStatus: "unverified",
            role: "limitation",
          }),
        ),
        requiredObservationIds: [],
        confidence: 0.9,
        importance: storyMode === "diagnostic" ? "critical" : "supporting",
        verificationStatus: "verified",
        uncertaintyNotes: [`${failed.length} assertion(s) failed.`],
        mustAppear: storyMode === "diagnostic",
        dependencies: [],
        conflictsWith: [],
      };
      if (storyMode === "diagnostic") {
        beats.push(candidate);
      } else {
        // Promotional mode: §22 — a failed assertion does not automatically become a
        // selected scene. Recorded as a rejected candidate (available, not selected).
        reject("beat", "limitation", candidate, "non-critical", "Promotional mode does not automatically select limitation beats for non-mandatory failures.");
      }
    }
  }

  // call-to-action
  const ctaConstraint = input.constraints.find((c) => c.kind === "cta-required");
  const ctaRequired = ctaConstraint ? ctaConstraint.value : PERSUASIVE_OBJECTIVES.includes(input.objective);
  if (ctaRequired && storyMode === "promotional") {
    beats.push({
      schemaVersion: "0.1",
      id: "beat-cta",
      kind: "call-to-action",
      purpose: `Ask the audience to act (${input.objective}).`,
      audienceTakeaway: "The audience knows what to do next.",
      sourceClaimIds: [],
      sourceFactIds: [],
      evidenceRefs: [],
      requiredObservationIds: [],
      confidence: 0.9,
      importance: "important",
      verificationStatus: "verified",
      uncertaintyNotes: [],
      mustAppear: true,
      dependencies: [],
      conflictsWith: [],
    });
  }

  // impact — from the first hypothesis, governed by unsupported-impact policy (§22)
  const hypothesis = [...pu.hypotheses].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (hypothesis) {
    const candidate: NarrativeBeat = {
      schemaVersion: "0.1",
      id: "beat-impact",
      kind: "impact",
      purpose: `Generalize the result: ${hypothesis.statement}`,
      audienceTakeaway: hypothesis.statement,
      sourceClaimIds: [],
      sourceFactIds: [],
      evidenceRefs: [
        evRef({
          idSuffix: `impact-${hypothesis.id}`,
          sourceType: "understanding-evidence",
          sourceArtifactId: "product-understanding",
          sourceItemId: hypothesis.id,
          sourceRunId: "n/a",
          verificationStatus: "unverified",
          role: "context",
        }),
      ],
      requiredObservationIds: [],
      confidence: hypothesis.confidence,
      importance: "supporting",
      verificationStatus: "unverified",
      uncertaintyNotes: ["Sourced solely from a Hypothesis; never promoted to fact."],
      mustAppear: false,
      dependencies: [],
      conflictsWith: [],
    };
    const permitted = storyMode === "diagnostic" || Boolean(allowUnverifiedImpact);
    if (permitted) {
      beats.push(candidate);
    } else {
      reject("beat", "impact", candidate, "unsupported-impact", "Unverified impact beat requires 'allow-unverified-impact' constraint in promotional mode (§22).");
    }
  }

  return { beats: beats.sort((a, b) => a.id.localeCompare(b.id)), rejected };

  function makeInteractionBeat(
    kind: NarrativeBeatKind,
    observation: DemoObservation,
    runId: string,
    artifactId: string,
    id: string,
    dep?: string,
  ): NarrativeBeat {
    return {
      schemaVersion: "0.1",
      id,
      kind,
      purpose: observation.statement,
      audienceTakeaway: observation.statement,
      sourceClaimIds: [],
      sourceFactIds: [],
      evidenceRefs: [
        evRef({
          idSuffix: `${id}-${observation.id}`,
          sourceType: "capture-observation",
          sourceArtifactId: artifactId,
          sourceItemId: observation.id,
          sourceRunId: runId,
          verificationStatus: observation.verificationStatus,
          role: kind === "result" ? "result" : "interaction",
        }),
      ],
      requiredObservationIds: [observation.id],
      confidence: observation.confidence,
      importance: "critical",
      verificationStatus: observation.verificationStatus,
      uncertaintyNotes: [],
      mustAppear: true,
      dependencies: dep ? [dep] : [],
      conflictsWith: [],
    };
  }
}

// ---------------------------------------------------------------------------
// §15 arc selection
// ---------------------------------------------------------------------------

function selectArc(
  beats: readonly NarrativeBeat[],
  input: StoryCompilerInput,
): { readonly arc: NarrativeArc; readonly overridden: boolean } {
  const override = input.constraints.find((c) => c.kind === "arc-override");
  if (override && override.kind === "arc-override") {
    return { arc: override.value, overridden: true };
  }
  const kinds = new Set(beats.map((b) => b.kind));
  let best = NARRATIVE_ARCS[0]!;
  let bestScore = -1;
  for (const candidate of NARRATIVE_ARCS) {
    const score = candidate.requiredBeats.filter((k) => kinds.has(k)).length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return { arc: best.arc, overridden: false };
}

// ---------------------------------------------------------------------------
// §9/§12 scene + sequence construction (one scene per selected beat)
// ---------------------------------------------------------------------------

function buildScenesAndSequences(
  beats: readonly NarrativeBeat[],
  arc: NarrativeArc,
): { readonly scenes: readonly StoryScene[]; readonly sequences: readonly StorySequence[] } {
  const arcDef = NARRATIVE_ARCS.find((a) => a.arc === arc)!;
  const kindOrder = new Map<NarrativeBeatKind, number>();
  arcDef.requiredBeats.forEach((k, i) => kindOrder.set(k, i));

  const ordered = [...beats].sort((a, b) => {
    const oa = kindOrder.get(a.kind) ?? 100 + SEQUENCE_ORDER.indexOf(SEQUENCE_KIND_FOR_BEAT[a.kind]);
    const ob = kindOrder.get(b.kind) ?? 100 + SEQUENCE_ORDER.indexOf(SEQUENCE_KIND_FOR_BEAT[b.kind]);
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });

  const sceneBySequence = new Map<StorySequenceKind, string[]>();
  const scenes: StoryScene[] = [];

  const idOf = (beatKind: string) => `scene-${beatKind}`;
  const proofExists = beats.some((b) => b.kind === "proof");
  const completeExists = beats.some((b) => b.kind === "interaction-complete");

  ordered.forEach((beat, idx) => {
    const sequenceKind = SEQUENCE_KIND_FOR_BEAT[beat.kind];
    const list = sceneBySequence.get(sequenceKind) ?? [];
    const id = idOf(beat.kind);
    list.push(id);
    sceneBySequence.set(sequenceKind, list);

    const dependsOnSceneIds: string[] = [];
    if (beat.kind === "proof" && completeExists) dependsOnSceneIds.push(idOf("interaction-complete"));
    if (beat.kind === "result") {
      if (proofExists) dependsOnSceneIds.push(idOf("proof"));
      else if (completeExists) dependsOnSceneIds.push(idOf("interaction-complete"));
    }
    if (beat.kind === "call-to-action") {
      if (beats.some((b) => b.kind === "result")) dependsOnSceneIds.push(idOf("result"));
      else dependsOnSceneIds.push(idOf("product-introduction"));
    }

    scenes.push({
      schemaVersion: "0.1",
      id,
      title: beat.purpose,
      purpose: beat.purpose,
      beatIds: [beat.id],
      primaryBeatId: beat.id,
      sequenceId: `sequence-${sequenceKind}`,
      order: idx,
      priority: beat.importance,
      durationTargetMs: MINIMUM_READABLE_SCENE_MS,
      durationRangeMs: { minimum: MINIMUM_READABLE_SCENE_MS, maximum: MINIMUM_READABLE_SCENE_MS * 4 },
      requiredEvidenceRefs: beat.evidenceRefs.map((e) => e.id),
      requiredClaimIds: beat.sourceClaimIds,
      requiredObservationIds: beat.requiredObservationIds,
      mustAppear: beat.mustAppear,
      mustNotAppearWith: [],
      dependsOnSceneIds,
      supportsSceneIds: [],
      transitionIn: transitionInFor(beat.kind),
      transitionOut: transitionOutFor(beat.kind),
      presentationIntent: presentationIntentFor(beat.kind),
      confidence: beat.confidence,
      whyThisSceneExists: `Carries beat "${beat.id}" (${beat.kind}), selected because it satisfies the "${arc}" arc's required narrative surface.`,
      rejectionRisk: beat.mustAppear ? [] : ["duration-budget"],
    });
  });

  const sequences: StorySequence[] = SEQUENCE_ORDER.filter((kind) => sceneBySequence.has(kind)).map((kind, order) => ({
    id: `sequence-${kind}`,
    kind,
    purpose: `${kind} sequence`,
    sceneIds: sceneBySequence.get(kind)!,
    order,
    durationBudgetMs: sceneBySequence.get(kind)!.length * MINIMUM_READABLE_SCENE_MS,
    required: kind === "demonstration" || kind === "proof" || kind === "outcome",
    completionCriteria: [`All scenes in the "${kind}" sequence carry a mustAppear or optional beat consistent with the "${arc}" arc.`],
  }));

  return { scenes, sequences };
}

function transitionInFor(kind: NarrativeBeatKind): StoryTransitionIntent {
  return identityTransition(kind, "in");
}
function transitionOutFor(kind: NarrativeBeatKind): StoryTransitionIntent {
  return identityTransition(kind, "out");
}
function identityTransition(kind: NarrativeBeatKind, dir: "in" | "out"): StoryTransitionIntent {
  if (kind === "proof" && dir === "out") return "proof-to-result";
  if (kind === "interaction-complete" && dir === "out") return "cause-to-effect";
  if (kind === "call-to-action" && dir === "in") return "conclusion";
  return "cut";
}

function presentationIntentFor(kind: NarrativeBeatKind) {
  const base = {
    framing: "focused-element" as const,
    textIntent: "label" as const,
    voiceIntent: "context" as const,
    motionIntent: "static" as const,
    artifactPreference: "no-preference" as const,
  };
  switch (kind) {
    case "proof":
      return { ...base, visualRole: "prove" as const, textIntent: "metric" as const, artifactPreference: "screenshot" as const };
    case "result":
      return { ...base, visualRole: "resolve" as const, textIntent: "metric" as const };
    case "call-to-action":
      return { ...base, visualRole: "conclude" as const, textIntent: "CTA" as const };
    case "interaction-start":
    case "interaction-progress":
    case "interaction-complete":
      return { ...base, visualRole: "demonstrate" as const, motionIntent: "focus" as const };
    case "comparison":
      return { ...base, visualRole: "compare" as const, framing: "before-after" as const };
    case "limitation":
      return { ...base, visualRole: "resolve" as const, textIntent: "warning" as const };
    default:
      return { ...base, visualRole: "establish" as const };
  }
}

// ---------------------------------------------------------------------------
// §17 proof chains
// ---------------------------------------------------------------------------

function buildProofChains(
  input: StoryCompilerInput,
  scenes: readonly StoryScene[],
  authoritative: BrowserCaptureRunInput | null,
): readonly ProofChain[] {
  const proofScene = scenes.find((s) => s.beatIds.includes("beat-proof"));
  const resultScene = scenes.find((s) => s.beatIds.includes("beat-result"));
  const interactionCompleteScene = scenes.find((s) => s.beatIds.includes("beat-interaction-complete"));

  return [...input.dir.evidence]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((requirement): ProofChain => {
      const passedAssertions = authoritative
        ? authoritative.result.assertions.filter((a) => a.status === "passed" && a.relatedArtifactIds.length > 0)
        : [];
      const failedAssertions = authoritative ? authoritative.result.assertions.filter((a) => a.status === "failed") : [];

      let status: ProofChainStatus;
      const gaps: string[] = [];
      if (passedAssertions.length > 0 && proofScene && resultScene) {
        status = "verified";
      } else if (passedAssertions.length > 0 || proofScene) {
        status = "partial";
        if (!resultScene) gaps.push("No result scene is present to close the proof chain.");
        if (passedAssertions.length === 0) gaps.push("No passed assertion with a linked artifact exists (screenshot-only support).");
      } else {
        status = "unsupported";
        if (failedAssertions.length > 0) gaps.push("Only failed assertions are available for this claim.");
        else gaps.push("No eligible evidence exists for this claim.");
      }

      return {
        id: `proof-chain-${requirement.id}`,
        claimId: requirement.id,
        contextSceneIds: [],
        actionSceneIds: interactionCompleteScene ? [interactionCompleteScene.id] : [],
        evidenceRefIds: proofScene ? proofScene.requiredEvidenceRefs : [],
        sourceAssertionIds: passedAssertions.map((a) => a.assertionId),
        sourceArtifactIds: passedAssertions.flatMap((a) => a.relatedArtifactIds),
        proofSceneIds: proofScene ? [proofScene.id] : [],
        resultSceneIds: resultScene ? [resultScene.id] : [],
        status,
        gaps,
      };
    });
}

// ---------------------------------------------------------------------------
// §18 duration budget
// ---------------------------------------------------------------------------

function allocateDuration(
  scenes: readonly StoryScene[],
  duration: StoryCompilerInput["duration"],
): { readonly scenes: readonly StoryScene[]; readonly budget: StoryDurationBudget } {
  if (scenes.length === 0) {
    return {
      scenes,
      budget: {
        targetMs: duration.targetMs,
        minimumMs: duration.minimumMs,
        maximumMs: duration.maximumMs,
        allocatedMs: 0,
        unallocatedMs: duration.targetMs,
        overBudgetMs: 0,
        compressionApplied: false,
      },
    };
  }

  const evenShare = Math.floor(duration.targetMs / scenes.length);
  let compressionApplied = false;
  const perScene = Math.max(evenShare, MINIMUM_READABLE_SCENE_MS);
  if (evenShare < MINIMUM_READABLE_SCENE_MS) compressionApplied = true;

  const nextScenes = scenes.map((s) => ({
    ...s,
    durationTargetMs: Math.min(Math.max(perScene, s.durationRangeMs.minimum), s.durationRangeMs.maximum),
  }));

  const allocatedMs = nextScenes.reduce((sum, s) => sum + s.durationTargetMs, 0);
  const overBudgetMs = Math.max(0, allocatedMs - duration.maximumMs);
  const unallocatedMs = Math.max(0, duration.targetMs - allocatedMs);

  return {
    scenes: nextScenes,
    budget: {
      targetMs: duration.targetMs,
      minimumMs: duration.minimumMs,
      maximumMs: duration.maximumMs,
      allocatedMs,
      unallocatedMs,
      overBudgetMs,
      compressionApplied: compressionApplied || overBudgetMs > 0,
    },
  };
}

// ---------------------------------------------------------------------------
// §23 coverage
// ---------------------------------------------------------------------------

function computeCoverage(args: {
  readonly input: StoryCompilerInput;
  readonly beats: readonly NarrativeBeat[];
  readonly scenes: readonly StoryScene[];
  readonly proofChains: readonly ProofChain[];
  readonly arc: NarrativeArc;
  readonly hero: HeroResolution;
}): StoryCoverage {
  const { input, beats, scenes, proofChains, arc, hero } = args;
  const requiredClaims = input.dir.evidence;
  const criticalClaims = requiredClaims.filter((c) => c.importance === "critical");
  const coveredClaims = proofChains.filter((p) => p.status !== "unsupported");
  const coveredCritical = criticalClaims.filter((c) => proofChains.find((p) => p.claimId === c.id)?.status === "verified");

  const arcDef = NARRATIVE_ARCS.find((a) => a.arc === arc)!;
  const beatKinds = new Set(beats.map((b) => b.kind));
  const satisfiedBeatCount = arcDef.requiredBeats.filter((k) => beatKinds.has(k)).length;

  const heroInteractionCovered = hero.sourceHeroInteractionId === null ? true : scenes.some((s) => s.beatIds.includes("beat-interaction-complete"));
  const resultCovered = arcDef.requiredBeats.includes("result") ? scenes.some((s) => s.beatIds.includes("beat-result")) : true;
  const ctaRequired = PERSUASIVE_OBJECTIVES.includes(input.objective) && resolveStoryMode(input) === "promotional";
  const ctaCovered = scenes.some((s) => s.beatIds.includes("beat-cta"));

  const narrativeCoverageRatio = arcDef.requiredBeats.length > 0 ? clamp01(satisfiedBeatCount / arcDef.requiredBeats.length) : 1;
  const proofCoverageRatio = requiredClaims.length > 0 ? clamp01(coveredClaims.length / requiredClaims.length) : 1;

  const sufficient =
    coveredCritical.length === criticalClaims.length &&
    heroInteractionCovered &&
    resultCovered &&
    (!ctaRequired || ctaCovered);

  return {
    requiredClaimCount: requiredClaims.length,
    coveredClaimCount: coveredClaims.length,
    criticalClaimCount: criticalClaims.length,
    coveredCriticalClaimCount: coveredCritical.length,
    requiredBeatCount: arcDef.requiredBeats.length,
    satisfiedBeatCount,
    verifiedProofChainCount: proofChains.filter((p) => p.status === "verified").length,
    partialProofChainCount: proofChains.filter((p) => p.status === "partial").length,
    unsupportedClaimCount: proofChains.filter((p) => p.status === "unsupported").length,
    unverifiedImpactBeatsAdmittedCount: beats.filter((b) => b.kind === "impact" && b.verificationStatus === "unverified").length,
    heroInteractionCovered,
    resultCovered,
    ctaRequired,
    ctaCovered,
    narrativeCoverageRatio,
    proofCoverageRatio,
    sufficient,
  };
}

// ---------------------------------------------------------------------------
// §9a renderer readiness
// ---------------------------------------------------------------------------

function computeRendererReadiness(scenes: readonly StoryScene[], beats: readonly NarrativeBeat[]): RendererReadiness {
  const beatById = new Map(beats.map((b) => [b.id, b]));
  const ready: string[] = [];
  const recapture: string[] = [];
  const blocked: string[] = [];
  const missingArtifacts: string[] = [];
  const recaptureRequirements: string[] = [];
  const reasons: string[] = [];

  for (const scene of scenes) {
    const beat = beatById.get(scene.primaryBeatId);
    const hasBrowserEvidence = beat?.evidenceRefs.some(
      (e) => e.sourceType === "capture-observation" || e.sourceType === "browser-assertion" || e.sourceType === "browser-screenshot" || e.sourceType === "browser-dom",
    );
    const isEvidenceBacked = (beat?.evidenceRefs.length ?? 0) > 0;

    if ((scene.priority === "critical") && !isEvidenceBacked) {
      blocked.push(scene.id);
      missingArtifacts.push(scene.id);
      reasons.push(`Critical scene "${scene.id}" has no supporting evidence reference.`);
    } else if (!hasBrowserEvidence) {
      recapture.push(scene.id);
      recaptureRequirements.push(`Scene "${scene.id}" has no browser-sourced evidence and would benefit from a capture run.`);
    } else {
      ready.push(scene.id);
    }
  }

  let status: RendererReadinessStatus;
  if (blocked.length > 0) status = "blocked";
  else if (recapture.length > 0) status = "recapture-required";
  else status = "ready";

  return {
    status,
    readySceneIds: ready,
    recaptureRequiredSceneIds: recapture,
    blockedSceneIds: blocked,
    missingArtifactIds: missingArtifacts,
    recaptureRequirements,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// §25 Story Gate
// ---------------------------------------------------------------------------

function computeGate(args: {
  readonly storyMode: StoryMode;
  readonly scenes: readonly StoryScene[];
  readonly coverage: StoryCoverage;
  readonly hero: HeroResolution;
  readonly durationBudget: StoryDurationBudget;
  readonly rendererReadiness: RendererReadiness;
  readonly captureSelection: CaptureSelection;
  readonly durationInvalid: boolean;
  readonly understandingGateFail: boolean;
}): StoryGate {
  const { storyMode, scenes, coverage, hero, durationBudget, rendererReadiness, captureSelection, durationInvalid, understandingGateFail } = args;
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const requirementsBeforeRender: string[] = [];

  if (durationInvalid) {
    blockingReasons.push(classifiedReason("invalid-input", "duration is required and was not supplied or was invalid."));
  }
  if (scenes.length === 0 && !durationInvalid) {
    blockingReasons.push(classifiedReason("structural-failure", "The storyboard has zero scenes."));
  }
  if (understandingGateFail && storyMode === "promotional") {
    blockingReasons.push(classifiedReason("insufficient-evidence", "UnderstandingGate reported fail and storyMode is promotional."));
  }
  if (coverage.coveredCriticalClaimCount < coverage.criticalClaimCount) {
    blockingReasons.push(classifiedReason("unsupported-claim", "A critical claim has no verified proof chain."));
    requirementsBeforeRender.push("Supply a verified ProofChain for every critical claim.");
  }
  if (hero.sourceHeroInteractionId && hero.continuityStatus === "broken") {
    blockingReasons.push(classifiedReason("structural-failure", "Hero Interaction continuity is broken."));
    requirementsBeforeRender.push("Recapture or otherwise verify the Hero Interaction.");
  }
  if (durationBudget.overBudgetMs > 0) {
    blockingReasons.push(classifiedReason("duration-infeasibility", `Storyboard is over budget by ${durationBudget.overBudgetMs}ms after compression.`));
  }
  if (captureSelection.unresolvedCriticalConflict) {
    blockingReasons.push(classifiedReason("insufficient-evidence", "Unresolved capture-run conflict under 'reject-conflict' policy."));
  }
  if (rendererReadiness.status === "blocked") {
    blockingReasons.push(classifiedReason("renderer-readiness-failure", "One or more critical scenes are renderer-blocked."));
  }

  if (blockingReasons.length > 0) {
    return { status: "fail", blockingReasons, warnings, requirementsBeforeRender };
  }

  if (!coverage.sufficient) warnings.push("Story coverage is not fully sufficient (non-critical gap).");
  if (rendererReadiness.status === "recapture-required") warnings.push("Some non-critical scenes require recapture.");
  if (captureSelection.conflicts.length > 0) warnings.push(...captureSelection.conflicts);
  if (coverage.unverifiedImpactBeatsAdmittedCount > 0) warnings.push("An unverified impact beat is included; this can never reach 'pass' on its own merit.");
  if (durationBudget.compressionApplied) warnings.push("Duration compression was applied.");

  const status: StoryGateStatus = warnings.length > 0 || coverage.unverifiedImpactBeatsAdmittedCount > 0 ? "conditional" : "pass";
  return { status, blockingReasons, warnings, requirementsBeforeRender };
}

// ---------------------------------------------------------------------------
// §24 metrics
// ---------------------------------------------------------------------------

function computeMetrics(args: {
  readonly scenes: readonly StoryScene[];
  readonly sequences: readonly StorySequence[];
  readonly coverage: StoryCoverage;
  readonly proofChains: readonly ProofChain[];
  readonly rejected: readonly RejectedStoryCandidate[];
  readonly durationBudget: StoryDurationBudget;
  readonly hero: HeroResolution;
  readonly beats: readonly NarrativeBeat[];
}): StoryMetrics {
  const { scenes, sequences, coverage, proofChains, rejected, durationBudget, hero, beats } = args;

  const durationOf = (kind: StorySequenceKind) => sequences.find((s) => s.kind === kind)?.durationBudgetMs ?? 0;
  const setupMs = durationOf("opening") + durationOf("context") + durationOf("problem");
  const interactionMs = durationOf("demonstration");
  const proofMs = durationOf("proof");
  const resultMs = durationOf("outcome");

  const rejectionCountByReason: Partial<Record<RejectionReasonCode, number>> = {};
  for (const r of rejected) {
    rejectionCountByReason[r.reasonCode] = (rejectionCountByReason[r.reasonCode] ?? 0) + 1;
  }

  const evidenceUsed = new Set(scenes.flatMap((s) => s.requiredEvidenceRefs));
  const evidenceAvailable = new Set(beats.flatMap((b) => b.evidenceRefs.map((e) => e.id)));

  return {
    narrativeCompleteness: coverage.narrativeCoverageRatio,
    proofDensity: scenes.length > 0 ? clamp01(proofChains.filter((p) => p.status === "verified").length / scenes.length) : 0,
    evidenceUtilization: evidenceAvailable.size > 0 ? clamp01(evidenceUsed.size / evidenceAvailable.size) : 0,
    redundancy: rejected.length > 0 ? clamp01(rejected.filter((r) => r.reasonCode === "duplicate").length / rejected.length) : 0,
    setupRatio: durationBudget.targetMs > 0 ? clamp01(setupMs / durationBudget.targetMs) : 0,
    interactionRatio: durationBudget.targetMs > 0 ? clamp01(interactionMs / durationBudget.targetMs) : 0,
    proofRatio: durationBudget.targetMs > 0 ? clamp01(proofMs / durationBudget.targetMs) : 0,
    resultRatio: durationBudget.targetMs > 0 ? clamp01(resultMs / durationBudget.targetMs) : 0,
    unsupportedClaimCount: coverage.unsupportedClaimCount,
    transitionCoherence: 1,
    sceneCount: scenes.length,
    sequenceCount: sequences.length,
    durationFit: durationBudget.targetMs > 0 ? clamp01(durationBudget.allocatedMs / durationBudget.targetMs) : 0,
    heroInteractionContinuity: hero.sourceHeroInteractionId === null ? "absent" : hero.continuityStatus,
    rejectionCountByReason,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class StoryEngine implements Engine<StoryCompilerInput, Storyboard> {
  readonly name = "reference-story-engine";
  readonly version = "0.1.0";

  private lastMetrics: EngineMetrics = { inputArtifacts: 0, outputArtifacts: 0, warnings: 0 };
  private lastDecisions: readonly StoryDecision[] = [];

  validate(input: StoryCompilerInput): ValidationResult {
    const issues: { path: string; code: string; message: string }[] = [];
    if (input.productUnderstanding.schemaVersion !== "0.2") {
      issues.push({ path: "productUnderstanding.schemaVersion", code: "schema-mismatch", message: 'productUnderstanding.schemaVersion must be "0.2".' });
    }
    if (input.dir.schemaVersion !== "0.2") {
      issues.push({ path: "dir.schemaVersion", code: "schema-mismatch", message: 'dir.schemaVersion must be "0.2".' });
    }
    if (input.existingDemoAnalysis && input.existingDemoAnalysis.schemaVersion !== "0.1") {
      issues.push({ path: "existingDemoAnalysis.schemaVersion", code: "schema-mismatch", message: 'existingDemoAnalysis.schemaVersion must be "0.1".' });
    }
    input.browserCaptures.forEach((c, i) => {
      if (c.result.schemaVersion !== "0.1") {
        issues.push({ path: `browserCaptures/${i}/result/schemaVersion`, code: "schema-mismatch", message: 'browserCaptures[].result.schemaVersion must be "0.1".' });
      }
    });
    const authRunId = input.captureSelectionPolicy?.authoritativeRunId;
    if (authRunId && !input.browserCaptures.some((c) => c.runId === authRunId)) {
      issues.push({ path: "captureSelectionPolicy.authoritativeRunId", code: "invalid-input", message: `authoritativeRunId "${authRunId}" does not correspond to any supplied browserCaptures entry.` });
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  async run(input: StoryCompilerInput, context: EngineContext): Promise<Storyboard> {
    const startedAt = context.now();
    const decisions: StoryDecision[] = [];
    const nowIso = () => context.now().toISOString();
    const decisionId = (suffix: string) => `decision-${context.runId}-${suffix}`;

    const storyMode = resolveStoryMode(input);
    decisions.push({
      decisionId: decisionId("story-mode-resolved"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: "story-engine",
      question: "What storyMode governs this compilation?",
      options: [
        { id: "promotional", label: "Default — no 'mode' constraint supplied." },
        { id: "diagnostic", label: "A { kind: 'mode', value: 'diagnostic' } constraint was supplied." },
      ],
      chosenOptionId: storyMode,
      reason: input.constraints.some((c) => c.kind === "mode") ? "An explicit diagnostic mode constraint was supplied." : "No mode constraint was supplied; promotional is the default (§26).",
      confidence: 1,
      authority: "policy",
      reversible: true,
      reasonCodes: ["§26 storyMode resolution"],
    });

    const durationInvalid =
      !input.duration ||
      !(input.duration.minimumMs <= input.duration.targetMs && input.duration.targetMs <= input.duration.maximumMs) ||
      input.duration.targetMs <= 0;

    const audience = input.audience ?? DEFAULT_STORY_AUDIENCE;

    const captureSelectionPolicy = input.captureSelectionPolicy ?? DEFAULT_CAPTURE_SELECTION_POLICY;
    const captureSelection = selectAuthoritativeCapture(input.browserCaptures, captureSelectionPolicy);
    decisions.push({
      decisionId: decisionId("capture-run-selected"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: "story-engine",
      question: "Which browser capture run is authoritative for conflict resolution?",
      options: input.browserCaptures.map((c) => ({ id: c.runId, label: `runId=${c.runId}, capturedAt=${c.capturedAt}, gate=${c.result.gate.status}` })),
      chosenOptionId: captureSelection.authoritative?.runId ?? "none",
      reason: `Resolved via captureSelectionPolicy.fallback="${captureSelectionPolicy.fallback}" (§26).`,
      confidence: 1,
      authority: "policy",
      reversible: true,
      reasonCodes: ["§26 BrowserCaptureSelectionPolicy"],
    });

    const hero = resolveHeroInteraction(input, captureSelection.authoritative);
    decisions.push({
      decisionId: decisionId("hero-interaction-resolved"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: "story-engine",
      question: "What is the resolved Hero Interaction narrative authority and verification status?",
      options: [
        { id: "human-selected", label: "RFC-0002 selectedHeroInteraction with authority: human." },
        { id: "analysis-derived", label: "RFC-0003 heroInteraction (status identified), used only absent human selection." },
        { id: "policy-selected", label: "RFC-0002 selectedHeroInteraction with non-human authority." },
        { id: "none", label: "No upstream Hero Interaction identified." },
      ],
      chosenOptionId: hero.narrativeAuthority ?? "none",
      reason: `verificationStatus=${hero.verificationStatus}, continuityStatus=${hero.continuityStatus} (§16 authority model).`,
      confidence: hero.confidence,
      authority: hero.narrativeAuthority === "human-selected" ? "human" : "policy",
      reversible: true,
      reasonCodes: ["§16 Hero Interaction authority model"],
    });

    if (durationInvalid) {
      const emptyBudget: StoryDurationBudget = {
        targetMs: 0,
        minimumMs: 0,
        maximumMs: 0,
        allocatedMs: 0,
        unallocatedMs: 0,
        overBudgetMs: 0,
        compressionApplied: false,
      };
      const gate = computeGate({
        storyMode,
        scenes: [],
        coverage: emptyCoverage(),
        hero,
        durationBudget: emptyBudget,
        rendererReadiness: { status: "blocked", readySceneIds: [], recaptureRequiredSceneIds: [], blockedSceneIds: [], missingArtifactIds: [], recaptureRequirements: [], reasons: [] },
        captureSelection,
        durationInvalid: true,
        understandingGateFail: input.productUnderstanding.gate.status === "fail",
      });
      decisions.push({
        decisionId: decisionId("story-gate-computed"),
        runId: context.runId,
        createdAt: nowIso(),
        engine: "story-engine",
        question: "What is the Story Gate status?",
        options: [{ id: "fail", label: "duration is required and was not supplied or was invalid (§18 Decision 8)." }],
        chosenOptionId: "fail",
        reason: gate.blockingReasons.join(" "),
        confidence: 1,
        authority: "policy",
        reversible: false,
        reasonCodes: ["§18 no-silent-duration-default"],
      });

      const board: Storyboard = {
        schemaVersion: "0.1",
        id: contentHashOf({ sourceArtifactIds: [], invalid: "duration" }),
        sourceArtifactIds: [],
        storyMode,
        audience,
        objective: input.objective,
        narrativeArc: null,
        beats: [],
        scenes: [],
        sequences: [],
        heroInteraction: null,
        proofChains: [],
        durationBudget: emptyBudget,
        coverage: emptyCoverage(),
        rendererReadiness: { status: "blocked", readySceneIds: [], recaptureRequiredSceneIds: [], blockedSceneIds: [], missingArtifactIds: [], recaptureRequirements: [], reasons: [] },
        rejectedCandidates: [],
        decisions,
        gate,
        metrics: computeMetrics({
          scenes: [],
          sequences: [],
          coverage: emptyCoverage(),
          proofChains: [],
          rejected: [],
          durationBudget: emptyBudget,
          hero,
          beats: [],
        }),
      };
      this.lastDecisions = decisions;
      this.lastMetrics = { startedAt: startedAt.toISOString(), completedAt: context.now().toISOString(), inputArtifacts: 1, outputArtifacts: 1, warnings: gate.warnings.length };
      return board;
    }

    const { beats, rejected: rejectedBeats } = generateCandidateBeats(input, storyMode, hero, captureSelection.authoritative);

    const { arc, overridden } = selectArc(beats, input);
    decisions.push({
      decisionId: decisionId("narrative-arc-selected"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: "story-engine",
      question: "Which NarrativeArc was selected?",
      options: NARRATIVE_ARCS.map((a) => ({ id: a.arc, label: `Requires: ${a.requiredBeats.join(", ")}` })),
      chosenOptionId: arc,
      reason: overridden ? "An explicit arc-override constraint was supplied." : "Highest required-beat coverage among candidate beats (§15 selection procedure), ties broken by declaration order.",
      confidence: 1,
      authority: overridden ? "human" : "engine",
      reversible: true,
      reasonCodes: ["§15 arc selection procedure"],
    });

    const { scenes: scenesBeforeDuration, sequences } = buildScenesAndSequences(beats, arc);
    const { scenes, budget: durationBudget } = allocateDuration(scenesBeforeDuration, input.duration);

    const proofChains = buildProofChains(input, scenes, captureSelection.authoritative);

    const coverage = computeCoverage({ input, beats, scenes, proofChains, arc, hero });
    const rendererReadiness = computeRendererReadiness(scenes, beats);

    const heroInteraction: HeroInteractionSequence | null = hero.sourceHeroInteractionId
      ? {
          id: "hero-interaction",
          sourceHeroInteractionId: hero.sourceHeroInteractionId,
          narrativeAuthority: hero.narrativeAuthority ?? "policy-selected",
          startSceneId: "scene-interaction-start",
          progressSceneIds: [],
          completionSceneId: "scene-interaction-complete",
          proofSceneIds: scenes.some((s) => s.beatIds.includes("beat-proof")) ? ["scene-proof"] : [],
          resultSceneId: scenes.some((s) => s.beatIds.includes("beat-result")) ? "scene-result" : null,
          continuityStatus: hero.continuityStatus,
          verificationStatus: hero.verificationStatus,
          alternativeVerifiedInteractionIds: [],
          confidence: hero.confidence,
        }
      : null;

    const gate = computeGate({
      storyMode,
      scenes,
      coverage,
      hero,
      durationBudget,
      rendererReadiness,
      captureSelection,
      durationInvalid: false,
      understandingGateFail: input.productUnderstanding.gate.status === "fail",
    });
    decisions.push({
      decisionId: decisionId("story-gate-computed"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: "story-engine",
      question: "What is the Story Gate status?",
      options: [
        { id: "pass", label: "All §25 PASS requirements are met." },
        { id: "conditional", label: "No blocking reason exists, but a warning-level gap remains." },
        { id: "fail", label: "At least one §25 FAIL condition applies." },
      ],
      chosenOptionId: gate.status,
      reason: gate.blockingReasons.length > 0 ? gate.blockingReasons.join(" ") : gate.warnings.length > 0 ? gate.warnings.join(" ") : "All Story Gate requirements are satisfied.",
      confidence: 1,
      authority: "policy",
      reversible: true,
      reasonCodes: ["§25 Story Gate"],
    });

    const rejectedCandidates = rejectedBeats;

    const metrics = computeMetrics({ scenes, sequences, coverage, proofChains, rejected: rejectedCandidates, durationBudget, hero, beats });

    const sourceArtifactIds = [
      "product-understanding",
      "dir",
      ...(input.existingDemoAnalysis ? ["existing-demo-analysis"] : []),
      ...input.browserCaptures.map((c) => c.artifactId).sort((a, b) => a.localeCompare(b)),
    ];

    const board: Storyboard = {
      schemaVersion: "0.1",
      id: contentHashOf({ sourceArtifactIds, schemaVersion: "0.1", objective: input.objective, storyMode, duration: input.duration, constraints: input.constraints }),
      sourceArtifactIds,
      storyMode,
      audience,
      objective: input.objective,
      narrativeArc: arc,
      beats,
      scenes,
      sequences,
      heroInteraction,
      proofChains,
      durationBudget,
      coverage,
      rendererReadiness,
      rejectedCandidates,
      decisions,
      gate,
      metrics,
    };

    this.lastDecisions = decisions;
    this.lastMetrics = {
      startedAt: startedAt.toISOString(),
      completedAt: context.now().toISOString(),
      inputArtifacts: 1,
      outputArtifacts: 1,
      warnings: gate.warnings.length,
    };
    return board;
  }

  decisionsFromLastRun(): readonly StoryDecision[] {
    return this.lastDecisions;
  }

  verify(output: Storyboard): VerificationResult {
    if (output.gate.status === "fail") {
      return { ok: false, issues: output.gate.blockingReasons.map((message) => ({ path: "gate", code: "story-gate-failed", message })) };
    }
    return { ok: true, score: output.coverage.narrativeCoverageRatio };
  }

  metrics(): EngineMetrics {
    return this.lastMetrics;
  }
}

function emptyCoverage(): StoryCoverage {
  return {
    requiredClaimCount: 0,
    coveredClaimCount: 0,
    criticalClaimCount: 0,
    coveredCriticalClaimCount: 0,
    requiredBeatCount: 0,
    satisfiedBeatCount: 0,
    verifiedProofChainCount: 0,
    partialProofChainCount: 0,
    unsupportedClaimCount: 0,
    unverifiedImpactBeatsAdmittedCount: 0,
    heroInteractionCovered: false,
    resultCovered: false,
    ctaRequired: false,
    ctaCovered: false,
    narrativeCoverageRatio: 0,
    proofCoverageRatio: 0,
    sufficient: false,
  };
}
