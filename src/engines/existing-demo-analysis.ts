import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import type { DecisionRecord } from "../core/decision.js";
import { clamp01 } from "../core/provenance.js";
import type { MediaSource } from "../core/media-source.js";
import type { MediaInspection } from "../core/media-inspection.js";
import { validateTranscript, type Transcript } from "../core/transcript.js";
import { validateObservationTimeline, type DemoObservation, type DemoObservationTimeline } from "../core/demo-observation.js";
import { clampScore, gradeForTotal, type DemoScore, type DemoScoreCategory } from "../core/demo-score.js";
import type {
  DemoClarityAnalysis,
  DemoRhythmAnalysis,
  DemoSectionType,
  DemoStructureAnalysis,
  DemoStructureSection,
  ExistingDemoAnalysis,
  ExistingDemoAnalysisGate,
  ExistingDemoAnalysisGateStatus,
  ExistingDemoEvidenceAnalysis,
  ExistingDemoEvidenceItem,
  ExistingDemoHeroAnalysis,
  ExistingDemoRisk,
  ExistingDemoUnknown,
  PacingStatus,
  TranscriptSummary,
} from "../core/existing-demo-analysis.js";

export type ExistingDemoAnalysisInput = {
  readonly source: MediaSource;
  readonly mediaInspection: MediaInspection;
  readonly transcript?: Transcript;
  readonly observationTimeline?: DemoObservationTimeline;
  readonly goal?: "explain" | "convince" | "prove" | "onboard";
};

const HERO_CANDIDATE_MIN_CONFIDENCE = 0.5;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function summarizeTranscript(transcript: Transcript | undefined): TranscriptSummary {
  if (!transcript) {
    return {
      present: false,
      segmentCount: 0,
      totalSpokenSeconds: 0,
      words: 0,
      wordsPerMinute: null,
      language: null,
      provenance: { sourceType: null },
    };
  }

  const totalSpokenSeconds = transcript.segments.reduce(
    (sum, segment) => sum + (segment.endSeconds - segment.startSeconds),
    0,
  );
  const words = transcript.segments.reduce((sum, segment) => sum + countWords(segment.text), 0);
  const wordsPerMinute = totalSpokenSeconds > 0 ? (words / totalSpokenSeconds) * 60 : null;

  return {
    present: true,
    segmentCount: transcript.segments.length,
    totalSpokenSeconds,
    words,
    wordsPerMinute,
    language: transcript.language,
    provenance: { sourceType: transcript.sourceType },
  };
}

type HeroCandidate = {
  readonly start: DemoObservation;
  readonly complete: DemoObservation;
  readonly proof: DemoObservation;
  readonly confidence: number;
  readonly verified: boolean;
};

/**
 * Deterministic Hero Interaction detection over supplied observations only. Transcript
 * content is never consulted — RFC-0003 explicitly forbids inferring a Hero Interaction
 * solely from transcript language.
 */
function detectHeroInteraction(
  observations: readonly DemoObservation[],
): { readonly analysis: ExistingDemoHeroAnalysis; readonly rationale: string } {
  const starts = observations.filter((o) => o.kind === "interaction-start").sort((a, b) => a.startSeconds - b.startSeconds);

  if (starts.length === 0) {
    return {
      analysis: {
        candidateStatement: null,
        sourceObservationIds: [],
        supportingEvidenceIds: [],
        interactionStart: null,
        interactionEnd: null,
        visibleOutcome: null,
        confidence: 0,
        status: "not-found",
      },
      rationale: "No interaction-start observation was supplied.",
    };
  }

  const candidates: HeroCandidate[] = [];
  for (const start of starts) {
    const complete = observations
      .filter((o) => (o.kind === "interaction-complete" || o.kind === "state-change") && o.startSeconds >= start.startSeconds)
      .sort((a, b) => a.startSeconds - b.startSeconds)[0];
    if (!complete) continue;

    const proof = observations
      .filter((o) => (o.kind === "result-visible" || o.kind === "proof-visible") && o.startSeconds >= start.startSeconds)
      .sort((a, b) => a.startSeconds - b.startSeconds)[0];
    if (!proof) continue;

    if (complete.startSeconds < start.startSeconds || proof.startSeconds < start.startSeconds) continue;

    const confidence = Math.min(start.confidence, complete.confidence, proof.confidence);
    if (confidence < HERO_CANDIDATE_MIN_CONFIDENCE) continue;

    const verified =
      start.verificationStatus === "verified" ||
      complete.verificationStatus === "verified" ||
      proof.verificationStatus === "verified";

    candidates.push({ start, complete, proof, confidence, verified });
  }

  if (candidates.length === 0) {
    return {
      analysis: {
        candidateStatement: null,
        sourceObservationIds: [],
        supportingEvidenceIds: [],
        interactionStart: null,
        interactionEnd: null,
        visibleOutcome: null,
        confidence: 0,
        status: "not-found",
      },
      rationale:
        "interaction-start observation(s) exist, but no chronologically-following interaction-complete/state-change plus result-visible/proof-visible chain met the minimum confidence threshold.",
    };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0]!;
  const tiedForBest = candidates.filter((c) => c.confidence === best.confidence);

  let status: ExistingDemoHeroAnalysis["status"];
  let rationale: string;
  if (tiedForBest.length > 1) {
    status = "ambiguous";
    rationale = `${tiedForBest.length} equally strong Hero Interaction candidates (confidence ${best.confidence}) were found; selection is ambiguous.`;
  } else if (!best.verified) {
    status = "candidate-only";
    rationale =
      "A complete interaction-start / interaction-complete / result-visible chain exists, but none of its supporting observations are verified.";
  } else {
    status = "identified";
    rationale =
      "Exactly one strongest interaction-start / interaction-complete / result-visible chain exists, in chronological order, with sufficient confidence and at least one verified supporting observation.";
  }

  return {
    analysis: {
      candidateStatement: best.start.statement,
      sourceObservationIds: [best.start.id, best.complete.id, best.proof.id],
      supportingEvidenceIds: best.proof.relatedEvidenceIds,
      interactionStart: best.start.startSeconds,
      interactionEnd: best.complete.endSeconds,
      visibleOutcome: best.proof.statement,
      confidence: best.confidence,
      status,
    },
    rationale,
  };
}

function analyzeEvidence(observations: readonly DemoObservation[]): ExistingDemoEvidenceAnalysis {
  const proofVisible = observations.filter((o) => o.kind === "proof-visible");
  const resultVisible = observations.filter((o) => o.kind === "result-visible");
  const spokenClaims = observations.filter((o) => o.kind === "claim-spoken");
  const onScreenClaims = observations.filter((o) => o.kind === "claim-on-screen");
  const beforeStates = [...observations.filter((o) => o.kind === "before-state")].sort(
    (a, b) => a.startSeconds - b.startSeconds,
  );
  const afterStates = [...observations.filter((o) => o.kind === "after-state")].sort(
    (a, b) => a.startSeconds - b.startSeconds,
  );

  const usedAfter = new Set<string>();
  const pairs: Array<{ readonly before: DemoObservation; readonly after: DemoObservation }> = [];
  for (const before of beforeStates) {
    const after = afterStates.find((candidate) => !usedAfter.has(candidate.id) && candidate.startSeconds >= before.endSeconds);
    if (after) {
      pairs.push({ before, after });
      usedAfter.add(after.id);
    }
  }

  const items: ExistingDemoEvidenceItem[] = [
    ...proofVisible.map((o) => ({
      id: `evidence-${o.id}`,
      kind: "proof-visible" as const,
      observationIds: [o.id],
      verificationStatus: o.verificationStatus,
      description: o.statement,
    })),
    ...resultVisible.map((o) => ({
      id: `evidence-${o.id}`,
      kind: "result-visible" as const,
      observationIds: [o.id],
      verificationStatus: o.verificationStatus,
      description: o.statement,
    })),
    // A spoken claim is never visual evidence (RFC-0003 Core Principle 4): it is forced
    // "unverified" here regardless of the input's own verificationStatus, because
    // "verified" would otherwise wrongly suggest visual proof.
    ...spokenClaims.map((o) => ({
      id: `evidence-${o.id}`,
      kind: "claim-spoken" as const,
      observationIds: [o.id],
      verificationStatus: "unverified" as const,
      description: o.statement,
    })),
    ...onScreenClaims.map((o) => ({
      id: `evidence-${o.id}`,
      kind: "claim-on-screen" as const,
      observationIds: [o.id],
      verificationStatus: o.verificationStatus,
      description: o.statement,
    })),
    ...pairs.map(({ before, after }) => ({
      id: `evidence-pair-${before.id}-${after.id}`,
      kind: "before-after-pair" as const,
      observationIds: [before.id, after.id],
      verificationStatus:
        before.verificationStatus === "verified" && after.verificationStatus === "verified"
          ? ("verified" as const)
          : ("unverified" as const),
      description: `Before/after pair: "${before.statement}" -> "${after.statement}"`,
    })),
  ];

  const provable = items.filter(
    (item) => item.kind === "proof-visible" || item.kind === "result-visible" || item.kind === "before-after-pair",
  );
  const verifiedVisualEvidenceCount = provable.filter((item) => item.verificationStatus === "verified").length;
  const proofCoverageRatio = provable.length > 0 ? clamp01(verifiedVisualEvidenceCount / provable.length) : 0;
  const unsupportedClaimCount = [...spokenClaims, ...onScreenClaims].filter(
    (o) => o.relatedEvidenceIds.length === 0,
  ).length;

  return {
    items,
    verifiedVisualEvidenceCount,
    spokenClaimCount: spokenClaims.length,
    onScreenClaimCount: onScreenClaims.length,
    resultVisibleCount: resultVisible.length,
    beforeAfterPairCount: pairs.length,
    unsupportedClaimCount,
    proofCoverageRatio,
  };
}

function analyzeRhythm(
  observations: readonly DemoObservation[],
  mediaInspection: MediaInspection,
  hero: ExistingDemoHeroAnalysis,
): DemoRhythmAnalysis {
  const durationSeconds = mediaInspection.durationSeconds;
  const warnings: string[] = [];

  if (observations.length === 0) {
    return {
      durationSeconds,
      observationDensity: null,
      averageObservationDuration: null,
      longestGapSeconds: null,
      openingDuration: null,
      proofArrivalSeconds: null,
      closingDuration: null,
      pacingStatus: "unknown",
      warnings: ["No observations were supplied; rhythm cannot be analyzed."],
    };
  }

  const sorted = [...observations].sort((a, b) => a.startSeconds - b.startSeconds);
  const totalObservedDuration = sorted.reduce((sum, o) => sum + (o.endSeconds - o.startSeconds), 0);
  const averageObservationDuration = totalObservedDuration / sorted.length;

  let longestGapSeconds = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i]!.startSeconds - sorted[i - 1]!.endSeconds;
    if (gap > longestGapSeconds) longestGapSeconds = gap;
  }

  const openingKinds = new Set(["title-card", "problem-context", "silence"]);
  const firstNonOpening = sorted.find((o) => !openingKinds.has(o.kind));
  const openingDuration = firstNonOpening ? firstNonOpening.startSeconds : null;

  const proofArrivalSeconds = hero.interactionStart;

  const ctaObservations = sorted.filter((o) => o.kind === "call-to-action");
  const closingDuration =
    durationSeconds !== null && ctaObservations.length > 0
      ? Math.max(0, durationSeconds - ctaObservations[0]!.startSeconds)
      : null;

  let pacingStatus: PacingStatus;
  if (durationSeconds === null || durationSeconds <= 0) {
    pacingStatus = "unknown";
  } else {
    const gapRatio = longestGapSeconds / durationSeconds;
    if (gapRatio > 0.3) {
      pacingStatus = "slow";
      warnings.push(`The longest uncovered gap (${longestGapSeconds}s) exceeds 30% of the total duration.`);
    } else if (averageObservationDuration < durationSeconds * 0.05) {
      pacingStatus = "fast";
    } else {
      pacingStatus = "balanced";
    }
  }

  if (ctaObservations.length === 0) {
    warnings.push("No call-to-action observation was supplied; closing duration is unknown.");
  }

  return {
    durationSeconds,
    observationDensity: durationSeconds && durationSeconds > 0 ? sorted.length / durationSeconds : null,
    averageObservationDuration,
    longestGapSeconds,
    openingDuration,
    proofArrivalSeconds,
    closingDuration,
    pacingStatus,
    warnings,
  };
}

function analyzeClarity(
  observations: readonly DemoObservation[],
  transcript: Transcript | undefined,
  hero: ExistingDemoHeroAnalysis,
): DemoClarityAnalysis {
  const kinds = new Set(observations.map((o) => o.kind));
  const warnings: string[] = [];

  const productVisible = kinds.has("product-ui-visible");
  const problemEstablished = kinds.has("problem-context");
  const valuePropositionPresent = kinds.has("claim-spoken") || kinds.has("claim-on-screen") || (transcript?.segments.length ?? 0) > 0;
  const heroInteractionVisible = hero.status === "identified" || hero.status === "candidate-only";
  const resultVisible = kinds.has("result-visible");
  const callToActionPresent = kinds.has("call-to-action");
  const evidenceTraceable = observations.some((o) => o.relatedEvidenceIds.length > 0);

  if (!productVisible) warnings.push("No product-ui-visible observation was supplied.");
  if (!problemEstablished) warnings.push("No problem-context observation was supplied.");
  if (!resultVisible) warnings.push("No result-visible observation was supplied.");
  if (!callToActionPresent) warnings.push("No call-to-action observation was supplied.");

  return {
    productVisible,
    problemEstablished,
    valuePropositionPresent,
    heroInteractionVisible,
    resultVisible,
    callToActionPresent,
    evidenceTraceable,
    warnings,
  };
}

function analyzeStructure(
  observations: readonly DemoObservation[],
  hero: ExistingDemoHeroAnalysis,
): DemoStructureAnalysis {
  const sections: DemoStructureSection[] = [];
  const missing: DemoSectionType[] = [];

  const openingObservations = observations
    .filter((o) => o.kind === "title-card" || o.kind === "problem-context")
    .sort((a, b) => a.startSeconds - b.startSeconds);
  if (openingObservations.length > 0) {
    sections.push({
      type: "opening",
      startSeconds: 0,
      endSeconds: openingObservations[openingObservations.length - 1]!.endSeconds,
      confidence: 0.6,
      supportingObservationIds: openingObservations.map((o) => o.id),
    });
  } else {
    missing.push("opening");
  }

  const problemObservations = observations.filter((o) => o.kind === "problem-context");
  if (problemObservations.length > 0) {
    sections.push({
      type: "problem",
      startSeconds: problemObservations[0]!.startSeconds,
      endSeconds: problemObservations[problemObservations.length - 1]!.endSeconds,
      confidence: 0.6,
      supportingObservationIds: problemObservations.map((o) => o.id),
    });
  } else {
    missing.push("problem");
  }

  const productObservations = observations
    .filter((o) => o.kind === "product-ui-visible")
    .sort((a, b) => a.startSeconds - b.startSeconds);
  if (productObservations.length > 0) {
    sections.push({
      type: "product-introduction",
      startSeconds: productObservations[0]!.startSeconds,
      endSeconds: productObservations[0]!.endSeconds,
      confidence: 0.7,
      supportingObservationIds: [productObservations[0]!.id],
    });
  } else {
    missing.push("product-introduction");
  }

  // No observation kind maps cleanly onto a "workflow" walkthrough today; this section
  // type is a documented future-extension point (see docs/005), so it is always missing.
  missing.push("workflow");

  if (hero.status === "identified" || hero.status === "candidate-only") {
    sections.push({
      type: "hero-interaction",
      startSeconds: hero.interactionStart ?? 0,
      endSeconds: hero.interactionEnd ?? hero.interactionStart ?? 0,
      confidence: hero.confidence,
      supportingObservationIds: hero.sourceObservationIds,
    });
  } else {
    missing.push("hero-interaction");
  }

  const evidenceObservations = observations.filter((o) => o.kind === "proof-visible");
  if (evidenceObservations.length > 0) {
    sections.push({
      type: "evidence",
      startSeconds: evidenceObservations[0]!.startSeconds,
      endSeconds: evidenceObservations[evidenceObservations.length - 1]!.endSeconds,
      confidence: 0.6,
      supportingObservationIds: evidenceObservations.map((o) => o.id),
    });
  } else {
    missing.push("evidence");
  }

  const resultObservations = observations.filter((o) => o.kind === "result-visible");
  if (resultObservations.length > 0) {
    sections.push({
      type: "result",
      startSeconds: resultObservations[0]!.startSeconds,
      endSeconds: resultObservations[resultObservations.length - 1]!.endSeconds,
      confidence: 0.7,
      supportingObservationIds: resultObservations.map((o) => o.id),
    });
  } else {
    missing.push("result");
  }

  const ctaObservations = observations.filter((o) => o.kind === "call-to-action");
  if (ctaObservations.length > 0) {
    sections.push({
      type: "call-to-action",
      startSeconds: ctaObservations[0]!.startSeconds,
      endSeconds: ctaObservations[ctaObservations.length - 1]!.endSeconds,
      confidence: 0.7,
      supportingObservationIds: ctaObservations.map((o) => o.id),
    });
    sections.push({
      type: "closing",
      startSeconds: ctaObservations[0]!.startSeconds,
      endSeconds: ctaObservations[ctaObservations.length - 1]!.endSeconds,
      confidence: 0.5,
      supportingObservationIds: ctaObservations.map((o) => o.id),
    });
  } else {
    missing.push("call-to-action");
    missing.push("closing");
  }

  const totalConsidered = sections.length + missing.length;
  const confidence =
    totalConsidered > 0 ? clamp01(sections.reduce((sum, section) => sum + section.confidence, 0) / totalConsidered) : 0;

  return { detectedSections: sections, missingSections: missing, confidence };
}

function computeScore(args: {
  readonly clarity: DemoClarityAnalysis;
  readonly hero: ExistingDemoHeroAnalysis;
  readonly evidence: ExistingDemoEvidenceAnalysis;
  readonly structure: DemoStructureAnalysis;
  readonly rhythm: DemoRhythmAnalysis;
  readonly observations: readonly DemoObservation[];
}): DemoScore {
  const { clarity, hero, evidence, structure, rhythm, observations } = args;

  const productUiIds = observations.filter((o) => o.kind === "product-ui-visible").map((o) => o.id);
  const problemIds = observations.filter((o) => o.kind === "problem-context").map((o) => o.id);
  const resultIds = observations.filter((o) => o.kind === "result-visible").map((o) => o.id);
  const ctaIds = observations.filter((o) => o.kind === "call-to-action").map((o) => o.id);

  const productClarity: DemoScoreCategory = {
    id: "product-clarity",
    label: "Product clarity",
    maximumPoints: 15,
    awardedPoints: clampScore((clarity.productVisible ? 10 : 0) + (clarity.valuePropositionPresent ? 5 : 0), 15),
    rationale: clarity.productVisible
      ? "The product UI is visibly demonstrated."
      : "No product-ui-visible observation was supplied, so product clarity cannot be credited.",
    supportingObservationIds: productUiIds,
    deductions: clarity.productVisible ? [] : [{ reason: "No product-ui-visible observation.", points: 10 }],
  };

  const problemFraming: DemoScoreCategory = {
    id: "problem-framing",
    label: "Problem framing",
    maximumPoints: 10,
    awardedPoints: clampScore(clarity.problemEstablished ? 10 : 0, 10),
    rationale: clarity.problemEstablished
      ? "A problem-context observation establishes the problem being solved."
      : "No problem-context observation was supplied.",
    supportingObservationIds: problemIds,
    deductions: clarity.problemEstablished ? [] : [{ reason: "No problem-context observation.", points: 10 }],
  };

  const heroPointsByStatus: Record<ExistingDemoHeroAnalysis["status"], number> = {
    identified: 20,
    "candidate-only": 10,
    ambiguous: 5,
    "not-found": 0,
  };
  const heroInteractionCategory: DemoScoreCategory = {
    id: "hero-interaction",
    label: "Hero Interaction",
    maximumPoints: 20,
    awardedPoints: clampScore(heroPointsByStatus[hero.status], 20),
    rationale: `Hero Interaction status is "${hero.status}" (confidence ${hero.confidence}).`,
    supportingObservationIds: hero.sourceObservationIds,
    deductions:
      hero.status === "identified"
        ? []
        : [{ reason: `Hero Interaction status "${hero.status}" earns less than full credit.`, points: 20 - heroPointsByStatus[hero.status] }],
  };

  const evidenceRaw = evidence.proofCoverageRatio * 20 + (evidence.beforeAfterPairCount > 0 ? 5 : 0);
  const evidenceDeductions: { reason: string; points: number }[] = [];
  if (evidence.spokenClaimCount > 0 && evidence.verifiedVisualEvidenceCount === 0) {
    evidenceDeductions.push({
      reason: "Transcript-derived spoken claims cannot substitute for visual proof.",
      points: 0,
    });
  }
  if (evidence.unsupportedClaimCount > 0) {
    evidenceDeductions.push({
      reason: `${evidence.unsupportedClaimCount} claim(s) have no linked evidence.`,
      points: 0,
    });
  }
  const evidenceQuality: DemoScoreCategory = {
    id: "evidence-quality",
    label: "Evidence quality",
    maximumPoints: 25,
    awardedPoints: clampScore(evidenceRaw, 25),
    rationale: `Verified visual proof coverage is ${(evidence.proofCoverageRatio * 100).toFixed(0)}% (${evidence.verifiedVisualEvidenceCount} verified item(s)).`,
    supportingObservationIds: evidence.items.flatMap((item) => item.observationIds),
    deductions: evidenceDeductions,
  };

  const resultVerified = evidence.items.some((item) => item.kind === "result-visible" && item.verificationStatus === "verified");
  const resultVisibility: DemoScoreCategory = {
    id: "result-visibility",
    label: "Result visibility",
    maximumPoints: 10,
    awardedPoints: clampScore(evidence.resultVisibleCount === 0 ? 0 : resultVerified ? 10 : 5, 10),
    rationale:
      evidence.resultVisibleCount === 0
        ? "No result-visible observation was supplied."
        : resultVerified
          ? "The result is visibly demonstrated and verified."
          : "The result is visibly demonstrated but not verified.",
    supportingObservationIds: resultIds,
    deductions: evidence.resultVisibleCount === 0 ? [{ reason: "No result-visible observation.", points: 10 }] : [],
  };

  const narrativeStructure: DemoScoreCategory = {
    id: "narrative-structure",
    label: "Narrative structure",
    maximumPoints: 10,
    awardedPoints: clampScore(structure.confidence * 10, 10),
    rationale: `${structure.detectedSections.length} of ${structure.detectedSections.length + structure.missingSections.length} structural sections were detected.`,
    supportingObservationIds: Array.from(
      new Set(structure.detectedSections.flatMap((section) => section.supportingObservationIds)),
    ),
    deductions:
      structure.missingSections.length > 0
        ? [{ reason: `${structure.missingSections.length} structural section(s) missing.`, points: 0 }]
        : [],
  };

  const rhythmPointsByStatus: Record<PacingStatus, number> = { balanced: 5, fast: 3, slow: 3, unknown: 0 };
  const rhythmAndPacing: DemoScoreCategory = {
    id: "rhythm-and-pacing",
    label: "Rhythm and pacing",
    maximumPoints: 5,
    awardedPoints: clampScore(rhythmPointsByStatus[rhythm.pacingStatus], 5),
    rationale: `Pacing status is "${rhythm.pacingStatus}".`,
    supportingObservationIds: [],
    deductions:
      rhythm.pacingStatus === "unknown"
        ? [{ reason: "Rhythm/pacing could not be determined (no observations or unknown media duration).", points: 5 }]
        : [],
  };

  const closingCta: DemoScoreCategory = {
    id: "closing-cta",
    label: "Closing / CTA",
    maximumPoints: 5,
    awardedPoints: clampScore(clarity.callToActionPresent ? 5 : 0, 5),
    rationale: clarity.callToActionPresent
      ? "A call-to-action observation is present."
      : "No call-to-action observation was supplied.",
    supportingObservationIds: ctaIds,
    deductions: clarity.callToActionPresent ? [] : [{ reason: "No call-to-action observation.", points: 5 }],
  };

  const categories = [
    productClarity,
    problemFraming,
    heroInteractionCategory,
    evidenceQuality,
    resultVisibility,
    narrativeStructure,
    rhythmAndPacing,
    closingCta,
  ];
  const total = categories.reduce((sum, category) => sum + category.awardedPoints, 0);

  return { total, maximum: 100, grade: gradeForTotal(total), categories };
}

function computeGate(args: {
  readonly mediaInspection: MediaInspection;
  readonly hasTranscript: boolean;
  readonly hasObservations: boolean;
  readonly hero: ExistingDemoHeroAnalysis;
  readonly evidence: ExistingDemoEvidenceAnalysis;
  readonly clarity: DemoClarityAnalysis;
  readonly risks: readonly ExistingDemoRisk[];
  readonly goal: "explain" | "convince" | "prove" | "onboard" | undefined;
}): ExistingDemoAnalysisGate {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const requirementsBeforeUse: string[] = [];

  if (args.mediaInspection.status !== "inspected") {
    blockingReasons.push(`Media could not be inspected (status: "${args.mediaInspection.status}").`);
  } else {
    if (args.mediaInspection.durationSeconds === null) {
      blockingReasons.push("Media duration is unknown.");
    }
    if (args.mediaInspection.videoStreams.length === 0) {
      blockingReasons.push("No usable video stream was found.");
    }
  }

  if (!args.hasTranscript && !args.hasObservations) {
    blockingReasons.push("No transcript and no observation timeline were supplied; nothing can be analyzed.");
  }

  if (args.goal === "prove" && args.hero.status === "not-found") {
    blockingReasons.push("No Hero Interaction could be identified for a proof-oriented analysis.");
  }

  if (args.risks.some((risk) => risk.severity === "critical")) {
    blockingReasons.push("An unresolved critical risk blocks safe use of this analysis.");
  }

  let status: ExistingDemoAnalysisGateStatus;
  if (blockingReasons.length > 0) {
    status = "fail";
    requirementsBeforeUse.push(...blockingReasons);
  } else {
    const heroOk = args.hero.status === "identified";
    const proofOk = args.evidence.verifiedVisualEvidenceCount > 0;
    const resultOk = args.clarity.resultVisible;

    if (!heroOk || !proofOk || !resultOk) {
      status = "conditional";
      if (!heroOk) {
        warnings.push(`Hero Interaction status is "${args.hero.status}", not "identified".`);
        requirementsBeforeUse.push("Identify and verify the Hero Interaction.");
      }
      if (!proofOk) {
        warnings.push("No verified visual proof is present.");
        requirementsBeforeUse.push("Verify at least one piece of visual evidence.");
      }
      if (!resultOk) {
        warnings.push("No result-visible observation was supplied.");
        requirementsBeforeUse.push("Supply a result-visible observation.");
      }
    } else if (!args.hasTranscript) {
      status = "conditional";
      warnings.push("No transcript was supplied.");
      requirementsBeforeUse.push("Supply a transcript for complete context.");
    } else {
      status = "pass";
    }
  }

  return { name: "existing-demo-analysis", status, blockingReasons, warnings, requirementsBeforeUse };
}

/**
 * Deterministic, local-only analysis of an existing demo video. Never performs
 * computer vision, speech recognition, or LLM-based semantic analysis — it only
 * mechanically inspects media metadata (via the supplied MediaInspection) and applies
 * fixed rules over externally supplied transcript/observation data.
 */
export class ExistingDemoAnalysisEngine implements Engine<ExistingDemoAnalysisInput, ExistingDemoAnalysis> {
  readonly name = "reference-existing-demo-analysis-engine";
  readonly version = "0.3.0";

  private lastMetrics: EngineMetrics = { inputArtifacts: 0, outputArtifacts: 0, warnings: 0 };
  private lastDecisions: readonly DecisionRecord[] = [];

  validate(input: ExistingDemoAnalysisInput): ValidationResult {
    const issues: { path: string; code: string; message: string }[] = [];

    if (input.mediaInspection.sourceId !== input.source.id) {
      issues.push({
        path: "mediaInspection.sourceId",
        code: "source-mismatch",
        message: `mediaInspection.sourceId "${input.mediaInspection.sourceId}" does not match source.id "${input.source.id}".`,
      });
    }

    if (input.transcript) {
      const result = validateTranscript(input.transcript, input.mediaInspection.durationSeconds);
      if (!result.ok) issues.push(...result.issues);
    }

    if (input.observationTimeline) {
      if (input.observationTimeline.sourceId !== input.source.id) {
        issues.push({
          path: "observationTimeline.sourceId",
          code: "source-mismatch",
          message: `observationTimeline.sourceId "${input.observationTimeline.sourceId}" does not match source.id "${input.source.id}".`,
        });
      }
      const result = validateObservationTimeline(input.observationTimeline);
      if (!result.ok) issues.push(...result.issues);
    }

    return issues.length === 0 ? { ok: true } : { ok: false, issues };
  }

  async run(input: ExistingDemoAnalysisInput, context: EngineContext): Promise<ExistingDemoAnalysis> {
    const startedAt = context.now();
    const decisions: DecisionRecord[] = [];
    const decisionId = (suffix: string) => `decision-${context.runId}-${suffix}`;
    const nowIso = () => context.now().toISOString();

    const observations = input.observationTimeline?.observations ?? [];

    const transcriptSummary = summarizeTranscript(input.transcript);
    const structurePassObservations = observations; // never mutated; read-only throughout

    const { analysis: heroInteraction, rationale: heroRationale } = detectHeroInteraction(structurePassObservations);
    decisions.push({
      decisionId: decisionId("hero-selection"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "What is the Hero Interaction status for this existing demo?",
      options: [
        { id: "identified", label: "A verified interaction-start/complete/result chain was found." },
        { id: "candidate-only", label: "A complete chain was found, but nothing in it is verified." },
        { id: "ambiguous", label: "Multiple equally strong candidate chains were found." },
        { id: "not-found", label: "No complete chain could be assembled." },
      ],
      chosenOptionId: heroInteraction.status,
      reason: heroRationale,
      confidence: heroInteraction.confidence,
      authority: "policy",
      reversible: true,
    });

    const evidenceAnalysis = analyzeEvidence(structurePassObservations);
    decisions.push({
      decisionId: decisionId("evidence-coverage"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "Is verified visual proof present, and how much?",
      options: [
        { id: "verified-present", label: "At least one verified visual evidence item exists." },
        { id: "unverified-only", label: "Evidence candidates exist but none are verified." },
        { id: "none", label: "No visual evidence candidates exist." },
      ],
      chosenOptionId:
        evidenceAnalysis.verifiedVisualEvidenceCount > 0
          ? "verified-present"
          : evidenceAnalysis.items.some((i) => i.kind !== "claim-spoken")
            ? "unverified-only"
            : "none",
      reason: `${evidenceAnalysis.verifiedVisualEvidenceCount} verified visual evidence item(s); proof coverage ratio ${evidenceAnalysis.proofCoverageRatio}. Spoken claims (${evidenceAnalysis.spokenClaimCount}) are never counted as visual proof.`,
      confidence: 1,
      authority: "policy",
      reversible: true,
    });

    const structure = analyzeStructure(structurePassObservations, heroInteraction);
    const rhythmAnalysis = analyzeRhythm(structurePassObservations, input.mediaInspection, heroInteraction);
    const clarityAnalysis = analyzeClarity(structurePassObservations, input.transcript, heroInteraction);

    const risks: ExistingDemoRisk[] = [];
    if (heroInteraction.status === "not-found") {
      risks.push({
        id: "risk-no-hero-interaction",
        category: "structure",
        severity: "high",
        description: "No Hero Interaction could be assembled from the supplied observations.",
        relatedObservationIds: [],
        mitigation: "Supply interaction-start, interaction-complete/state-change, and result-visible/proof-visible observations in chronological order.",
      });
    } else if (heroInteraction.status === "candidate-only") {
      risks.push({
        id: "risk-unverified-hero-interaction",
        category: "evidence",
        severity: "medium",
        description: "A Hero Interaction candidate exists but none of its supporting observations are verified.",
        relatedObservationIds: heroInteraction.sourceObservationIds,
        mitigation: "Have a human reviewer (or future capture adapter) verify the interaction chain's observations.",
      });
    } else if (heroInteraction.status === "ambiguous") {
      risks.push({
        id: "risk-ambiguous-hero-interaction",
        category: "structure",
        severity: "medium",
        description: "Multiple equally strong Hero Interaction candidates were found.",
        relatedObservationIds: [],
        mitigation: "Add distinguishing observations, or a human reviewer annotation, to break the tie.",
      });
    }
    if (evidenceAnalysis.unsupportedClaimCount > 0) {
      risks.push({
        id: "risk-unsupported-claims",
        category: "evidence",
        severity: "low",
        description: `${evidenceAnalysis.unsupportedClaimCount} claim observation(s) have no linked evidence.`,
        relatedObservationIds: [],
        mitigation: "Link claim observations to relatedEvidenceIds, or supply supporting proof-visible/result-visible observations.",
      });
    }

    const unknowns: ExistingDemoUnknown[] = [];
    if (!clarityAnalysis.problemEstablished) {
      unknowns.push({
        id: "unknown-problem-context",
        question: "What problem does this demo establish?",
        reason: "No problem-context observation was supplied.",
        impact: "Problem framing cannot be scored or included in the narrative structure.",
        acquisitionMethod: "human-annotation",
      });
    }
    if (!input.transcript) {
      unknowns.push({
        id: "unknown-transcript",
        question: "What is spoken in this demo?",
        reason: "No transcript was supplied.",
        impact: "Spoken claims and narration context are unavailable.",
        acquisitionMethod: "speech-to-text",
      });
    }

    const score = computeScore({
      clarity: clarityAnalysis,
      hero: heroInteraction,
      evidence: evidenceAnalysis,
      structure,
      rhythm: rhythmAnalysis,
      observations: structurePassObservations,
    });

    const gate = computeGate({
      mediaInspection: input.mediaInspection,
      hasTranscript: Boolean(input.transcript),
      hasObservations: observations.length > 0,
      hero: heroInteraction,
      evidence: evidenceAnalysis,
      clarity: clarityAnalysis,
      risks,
      goal: input.goal,
    });

    decisions.push({
      decisionId: decisionId("analysis-gate"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "What is the Existing Demo Analysis Gate status?",
      options: [
        { id: "pass", label: "Media inspected, Hero Interaction identified, proof verified, result visible, transcript present." },
        { id: "conditional", label: "Analysis ran but conclusions are incomplete or unverified." },
        { id: "fail", label: "Analysis cannot run or produce usable conclusions." },
      ],
      chosenOptionId: gate.status,
      reason:
        gate.blockingReasons.length > 0
          ? gate.blockingReasons.join(" ")
          : gate.warnings.length > 0
            ? gate.warnings.join(" ")
            : "All Analysis Gate requirements are satisfied.",
      confidence: 1,
      authority: "policy",
      reversible: true,
    });

    const analysis: ExistingDemoAnalysis = {
      schemaVersion: "0.1",
      source: input.source,
      mediaInspection: input.mediaInspection,
      transcriptSummary,
      structure,
      heroInteraction,
      evidenceAnalysis,
      rhythmAnalysis,
      clarityAnalysis,
      risks,
      unknowns,
      score,
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

    return analysis;
  }

  decisionsFromLastRun(): readonly DecisionRecord[] {
    return this.lastDecisions;
  }

  verify(output: ExistingDemoAnalysis): VerificationResult {
    if (output.gate.status === "fail") {
      return {
        ok: false,
        issues: output.gate.blockingReasons.map((message) => ({
          path: "gate",
          code: "analysis-gate-failed",
          message,
        })),
      };
    }
    return { ok: true, score: output.score.total / output.score.maximum };
  }

  metrics(): EngineMetrics {
    return this.lastMetrics;
  }
}
