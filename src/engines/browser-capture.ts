import type { Engine, EngineContext } from "../core/engine.js";
import type { EngineMetrics, ValidationResult, VerificationResult } from "../core/types.js";
import type { DecisionRecord } from "../core/decision.js";
import { clamp01 } from "../core/provenance.js";
import type { BrowserAdapter, BrowserAdapterExecution } from "../adapters/browser-adapter.js";
import {
  validateCapturePlan,
  type AssertStep,
  type BrowserCapturePlan,
  type BrowserEvidenceRequirement,
} from "../core/browser-capture-plan.js";
import { evaluateAssertion, type BrowserAssertionResult } from "../core/browser-assertion.js";
import type { BrowserStepResult, BrowserStepStatus } from "../core/browser-capture-artifacts.js";
import type { BrowserScreenshotArtifact } from "../core/browser-capture-artifacts.js";
import type {
  BrowserEvidenceArtifactReference,
  BrowserEvidenceCoverage,
  BrowserEvidenceManifest,
  BrowserEvidenceRequirementResult,
} from "../core/browser-evidence-manifest.js";
import type { BrowserCaptureGate, BrowserCaptureGateStatus, BrowserCaptureResult } from "../core/browser-capture-result.js";
import type { DemoObservation, DemoObservationKind } from "../core/demo-observation.js";

export type BrowserCaptureEngineInput = {
  readonly plan: BrowserCapturePlan;
  readonly screenshotsDir: string;
  readonly domDir: string;
};

function finalizeStepResults(execution: BrowserAdapterExecution): readonly BrowserStepResult[] {
  return execution.stepResults.map((result) => ({
    stepId: result.stepId,
    kind: result.kind,
    status: result.status,
    message: result.message,
    startedAtSeconds: result.startedAtMs / 1000,
    endedAtSeconds: result.endedAtMs / 1000,
    blocking: result.blocking,
  }));
}

function buildAssertions(plan: BrowserCapturePlan, execution: BrowserAdapterExecution, nowIso: () => string): BrowserAssertionResult[] {
  const observationByStepId = new Map(execution.assertionObservations.map((observation) => [observation.stepId, observation]));
  const results: BrowserAssertionResult[] = [];

  for (const step of plan.steps) {
    if (step.kind !== "assert") continue;
    const observation = observationByStepId.get(step.id);
    if (!observation) continue;

    const sensitive = observation.sensitive ?? step.sensitive;
    results.push(
      evaluateAssertion({
        assertionId: step.id,
        stepId: step.id,
        kind: step.assertionKind,
        expected: step.expected,
        actual: observation.actual,
        observedAt: nowIso(),
        relatedArtifactIds: observation.relatedArtifactIds,
        ...(sensitive !== undefined ? { sensitive } : {}),
        ...(observation.error !== undefined ? { observationError: observation.error } : {}),
      }),
    );
  }

  return results;
}

/**
 * Deterministic observation generation over real capture execution — never invents
 * what happened. A screenshot alone never becomes `proof-visible`: that requires a
 * passed assertion, observed after a click, immediately preceding the screenshot in
 * plan order. See docs/006 for the full documented rule set.
 */
function generateObservations(
  plan: BrowserCapturePlan,
  stepResults: readonly BrowserStepResult[],
  assertions: readonly BrowserAssertionResult[],
  screenshots: readonly BrowserScreenshotArtifact[],
): DemoObservation[] {
  const observations: DemoObservation[] = [];
  const stepIndexById = new Map(plan.steps.map((step, index) => [step.id, index]));
  const resultByStepId = new Map(stepResults.map((result) => [result.stepId, result]));
  const assertionByStepId = new Map(assertions.map((assertion) => [assertion.stepId, assertion]));
  const screenshotByStepId = new Map(screenshots.map((screenshot) => [screenshot.stepId, screenshot]));

  const completedClickStepIds = plan.steps
    .filter((step) => step.kind === "click" && resultByStepId.get(step.id)?.status === "completed")
    .map((step) => step.id);
  const firstClickIndex = completedClickStepIds.length > 0 ? stepIndexById.get(completedClickStepIds[0]!)! : Infinity;

  let counter = 0;
  const nextId = (kind: string) => {
    counter += 1;
    return `obs-${kind}-${counter}`;
  };

  let mostRecentClickId: string | null = null;
  const interactionCompleteEmittedForClick = new Set<string>();

  plan.steps.forEach((step, index) => {
    const result = resultByStepId.get(step.id);
    if (!result) return;

    if (step.kind === "click" && result.status === "completed") {
      mostRecentClickId = step.id;
      observations.push({
        id: nextId("interaction-start"),
        kind: "interaction-start",
        startSeconds: result.startedAtSeconds,
        endSeconds: result.endedAtSeconds,
        statement: step.description,
        sourceType: "capture",
        verificationStatus: "verified",
        confidence: 1,
        relatedEvidenceIds: [step.id],
      });
    }

    if (step.kind === "assert") {
      const assertion = assertionByStepId.get(step.id);
      if (assertion?.status === "passed") {
        const isBeforeAnyClick = index < firstClickIndex;

        if (isBeforeAnyClick && step.assertionKind === "element-visible") {
          observations.push({
            id: nextId("product-ui-visible"),
            kind: "product-ui-visible",
            startSeconds: result.startedAtSeconds,
            endSeconds: result.endedAtSeconds,
            statement: step.description,
            sourceType: "capture",
            verificationStatus: "verified",
            confidence: 1,
            relatedEvidenceIds: [assertion.assertionId],
          });
        } else if (!isBeforeAnyClick && mostRecentClickId) {
          const alreadyComplete = interactionCompleteEmittedForClick.has(mostRecentClickId);
          const kind: DemoObservationKind = alreadyComplete ? "state-change" : "interaction-complete";
          interactionCompleteEmittedForClick.add(mostRecentClickId);

          observations.push({
            id: nextId(kind),
            kind,
            startSeconds: result.startedAtSeconds,
            endSeconds: result.endedAtSeconds,
            statement: step.description,
            sourceType: "capture",
            verificationStatus: "verified",
            confidence: 1,
            relatedEvidenceIds: [assertion.assertionId],
          });

          if (step.importance === "critical") {
            observations.push({
              id: nextId("result-visible"),
              kind: "result-visible",
              startSeconds: result.startedAtSeconds,
              endSeconds: result.endedAtSeconds,
              statement: step.description,
              sourceType: "capture",
              verificationStatus: "verified",
              confidence: 1,
              relatedEvidenceIds: [assertion.assertionId],
            });
          }
        }
      }
    }

    if (step.kind === "screenshot") {
      const screenshot = screenshotByStepId.get(step.id);
      if (!screenshot) return;

      const previousStep = index > 0 ? plan.steps[index - 1] : undefined;
      const previousAssertion = previousStep?.kind === "assert" ? assertionByStepId.get(previousStep.id) : undefined;
      const previousIsPassedPostClickAssertion =
        previousAssertion?.status === "passed" && previousStep && stepIndexById.get(previousStep.id)! >= firstClickIndex;

      if (previousIsPassedPostClickAssertion && previousAssertion) {
        observations.push({
          id: nextId("proof-visible"),
          kind: "proof-visible",
          startSeconds: result.startedAtSeconds,
          endSeconds: result.endedAtSeconds,
          statement: step.description,
          sourceType: "capture",
          verificationStatus: "verified",
          confidence: 1,
          relatedEvidenceIds: [screenshot.id, previousAssertion.assertionId],
        });
      } else if (index < firstClickIndex) {
        observations.push({
          id: nextId("before-state"),
          kind: "before-state",
          startSeconds: result.startedAtSeconds,
          endSeconds: result.endedAtSeconds,
          statement: step.description,
          sourceType: "capture",
          verificationStatus: "verified",
          confidence: 1,
          relatedEvidenceIds: [screenshot.id],
        });
      } else {
        observations.push({
          id: nextId("after-state"),
          kind: "after-state",
          startSeconds: result.startedAtSeconds,
          endSeconds: result.endedAtSeconds,
          statement: step.description,
          sourceType: "capture",
          verificationStatus: "verified",
          confidence: 1,
          relatedEvidenceIds: [screenshot.id],
        });
      }
    }
  });

  return observations;
}

function evaluateRequirement(
  requirement: BrowserEvidenceRequirement,
  assertions: readonly BrowserAssertionResult[],
  screenshots: readonly BrowserScreenshotArtifact[],
  domSnapshotCount: number,
  finalUrl: string | null,
  verifiedArtifactCount: number,
): BrowserEvidenceRequirementResult {
  const reasons: string[] = [];
  let satisfied = true;

  if (verifiedArtifactCount < requirement.minimumVerifiedArtifacts) {
    satisfied = false;
    reasons.push(
      `only ${verifiedArtifactCount} verified artifact(s) exist, below minimumVerifiedArtifacts (${requirement.minimumVerifiedArtifacts})`,
    );
  }

  for (const kind of requirement.requiredArtifactKinds) {
    switch (kind) {
      case "screenshot":
        if (screenshots.length === 0) {
          satisfied = false;
          reasons.push("no screenshot artifact exists");
        }
        break;
      case "dom-snapshot":
        if (domSnapshotCount === 0) {
          satisfied = false;
          reasons.push("no DOM snapshot artifact exists");
        }
        break;
      case "assertion":
        if (requirement.requiredAssertionIds.length === 0) {
          satisfied = false;
          reasons.push("no requiredAssertionIds declared for an assertion requirement");
        }
        break;
      case "url":
        if (finalUrl === null) {
          satisfied = false;
          reasons.push("no final URL was captured");
        }
        break;
    }
  }

  for (const assertionId of requirement.requiredAssertionIds) {
    const assertion = assertions.find((candidate) => candidate.assertionId === assertionId);
    if (!assertion || assertion.status !== "passed") {
      satisfied = false;
      reasons.push(`required assertion "${assertionId}" did not pass`);
    }
  }

  return {
    requirementId: requirement.id,
    claim: requirement.claim,
    satisfied,
    importance: requirement.importance,
    reason: satisfied ? "All declared conditions were met." : `Unsatisfied: ${reasons.join("; ")}.`,
  };
}

const BLOCKING_SAFETY_KINDS = new Set(["origin-disallowed", "external-navigation-blocked", "sensitive-value-exposure"]);

function computeGate(args: {
  readonly plan: BrowserCapturePlan;
  readonly execution: BrowserAdapterExecution;
  readonly stepResults: readonly BrowserStepResult[];
  readonly assertions: readonly BrowserAssertionResult[];
  readonly coverage: BrowserEvidenceCoverage;
  readonly requirementResults: readonly BrowserEvidenceRequirementResult[];
  /**
   * Verified artifacts EXCLUDING the bare "url" reference. Reaching some URL is not
   * meaningful evidence on its own (nearly every successful navigation produces one),
   * so it must never be sufficient by itself to satisfy "at least one verified evidence
   * artifact exists" / avoid "no verified evidence generated".
   */
  readonly meaningfulVerifiedArtifactCount: number;
}): BrowserCaptureGate {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const requirementsBeforeUse: string[] = [];

  if (!args.execution.launch.launched) {
    blockingReasons.push(`Browser failed to launch: ${args.execution.launch.failureReason ?? "unknown reason"}.`);
  }

  for (const violation of args.execution.safetyViolations) {
    if (BLOCKING_SAFETY_KINDS.has(violation.kind)) {
      blockingReasons.push(`Safety violation (${violation.kind}): ${violation.message}`);
    }
  }

  const criticalAssertSteps = args.plan.steps.filter(
    (step): step is AssertStep => step.kind === "assert" && step.importance === "critical",
  );
  for (const step of criticalAssertSteps) {
    const assertion = args.assertions.find((candidate) => candidate.stepId === step.id);
    if (!assertion || assertion.status !== "passed") {
      blockingReasons.push(`Critical assertion "${step.id}" did not pass.`);
    }
  }

  if (args.stepResults.some((result) => result.blocking && (result.status === "failed" || result.status === "timeout"))) {
    blockingReasons.push("A blocking step failed or timed out, halting the capture.");
  }

  const unresolvedRequirements = args.requirementResults.filter((result) => !result.satisfied);
  if (unresolvedRequirements.some((result) => result.importance === "critical")) {
    blockingReasons.push("A critical evidence requirement was not satisfied.");
  }

  if (args.execution.durationMs >= args.plan.policy.maximumDurationMs) {
    blockingReasons.push("Capture exceeded the maximum allowed duration.");
  }

  if (args.execution.launch.launched && args.meaningfulVerifiedArtifactCount === 0) {
    blockingReasons.push("No verified evidence artifact was generated.");
  }

  let status: BrowserCaptureGateStatus;
  if (blockingReasons.length > 0) {
    status = "fail";
    requirementsBeforeUse.push(...blockingReasons);
  } else {
    const nonCriticalUnresolved = unresolvedRequirements.filter((result) => result.importance !== "critical");
    const nonCriticalStepFailed = args.stepResults.some(
      (result) => !result.blocking && (result.status === "failed" || result.status === "timeout"),
    );
    const nonCriticalAssertionFailed = args.assertions.some(
      (assertion) => assertion.status !== "passed" && !criticalAssertSteps.some((step) => step.id === assertion.stepId),
    );
    const remoteTargetNeedsReview = args.plan.target.type === "explicit-remote";
    const nonBlockingSafetyEvents = args.execution.safetyViolations.filter((violation) => !BLOCKING_SAFETY_KINDS.has(violation.kind));

    if (
      nonCriticalUnresolved.length > 0 ||
      nonCriticalStepFailed ||
      nonCriticalAssertionFailed ||
      remoteTargetNeedsReview ||
      nonBlockingSafetyEvents.length > 0
    ) {
      status = "conditional";
      if (nonCriticalUnresolved.length > 0) {
        warnings.push(`${nonCriticalUnresolved.length} non-critical evidence requirement(s) unmet.`);
        requirementsBeforeUse.push("Review unmet non-critical evidence requirements.");
      }
      if (nonCriticalStepFailed) warnings.push("A non-blocking step failed.");
      if (nonCriticalAssertionFailed) warnings.push("A non-critical assertion failed.");
      if (remoteTargetNeedsReview) {
        warnings.push("Target is explicit-remote and requires manual review before trusted use.");
        requirementsBeforeUse.push("Manually review the explicit-remote target capture.");
      }
      if (nonBlockingSafetyEvents.length > 0) {
        warnings.push(`${nonBlockingSafetyEvents.length} non-blocking safety event(s) occurred.`);
      }
    } else {
      status = "pass";
    }
  }

  return { name: "browser-capture", status, blockingReasons, warnings, requirementsBeforeUse };
}

/**
 * Orchestrates a replaceable BrowserAdapter and compiles its raw execution output into
 * deterministic domain results: finalized assertions, generated observations, evidence
 * coverage, and the Capture Gate. All comparison/classification logic here is pure and
 * fully testable with a fake adapter — no real browser required.
 */
export class BrowserCaptureEngine implements Engine<BrowserCaptureEngineInput, BrowserCaptureResult> {
  readonly name = "reference-browser-capture-engine";
  readonly version = "0.4.0";

  private lastMetrics: EngineMetrics = { inputArtifacts: 0, outputArtifacts: 0, warnings: 0 };
  private lastDecisions: readonly DecisionRecord[] = [];

  constructor(private readonly adapter: BrowserAdapter) {}

  validate(input: BrowserCaptureEngineInput): ValidationResult {
    return validateCapturePlan(input.plan);
  }

  async run(input: BrowserCaptureEngineInput, context: EngineContext): Promise<BrowserCaptureResult> {
    const startedAt = context.now();
    const decisions: DecisionRecord[] = [];
    const decisionId = (suffix: string) => `decision-${context.runId}-${suffix}`;
    const nowIso = () => context.now().toISOString();

    const execution = await this.adapter.execute(input.plan, context, {
      screenshotsDir: input.screenshotsDir,
      domDir: input.domDir,
    });

    const stepResults = finalizeStepResults(execution);
    const assertions = buildAssertions(input.plan, execution, nowIso);
    const observationTimelineObservations = generateObservations(input.plan, stepResults, assertions, execution.screenshots);

    const artifacts: BrowserEvidenceArtifactReference[] = [
      ...execution.screenshots.map((screenshot) => ({
        id: `evidence-ref-${screenshot.id}`,
        kind: "screenshot" as const,
        artifactId: screenshot.id,
        verified: true,
      })),
      ...execution.domSnapshots.map((snapshot) => ({
        id: `evidence-ref-${snapshot.id}`,
        kind: "dom-snapshot" as const,
        artifactId: snapshot.id,
        verified: true,
      })),
      ...assertions.map((assertion) => ({
        id: `evidence-ref-${assertion.assertionId}`,
        kind: "assertion" as const,
        artifactId: assertion.assertionId,
        verified: assertion.status === "passed",
      })),
      ...(execution.finalUrl !== null
        ? [{ id: "evidence-ref-url", kind: "url" as const, artifactId: "final-url", verified: true }]
        : []),
    ];
    const verifiedArtifactCount = artifacts.filter((artifact) => artifact.verified).length;

    const requirementResults = input.plan.evidenceRequirements.map((requirement) =>
      evaluateRequirement(
        requirement,
        assertions,
        execution.screenshots,
        execution.domSnapshots.length,
        execution.finalUrl,
        verifiedArtifactCount,
      ),
    );
    const unresolvedRequirements = requirementResults.filter((result) => !result.satisfied);

    const requirementCount = input.plan.evidenceRequirements.length;
    const satisfiedCount = requirementResults.filter((result) => result.satisfied).length;
    const criticalRequirements = input.plan.evidenceRequirements.filter((requirement) => requirement.importance === "critical");
    const satisfiedCriticalCount = requirementResults.filter(
      (result) => result.satisfied && result.importance === "critical",
    ).length;
    const coverage: BrowserEvidenceCoverage = {
      requirementCount,
      satisfiedCount,
      criticalRequirementCount: criticalRequirements.length,
      satisfiedCriticalCount,
      verifiedArtifactCount,
      coverageRatio: requirementCount > 0 ? clamp01(satisfiedCount / requirementCount) : verifiedArtifactCount > 0 ? 1 : 0,
      sufficient: requirementCount > 0 ? satisfiedCount === requirementCount : verifiedArtifactCount > 0,
    };

    decisions.push({
      decisionId: decisionId("evidence-coverage"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "Is captured evidence sufficient to satisfy the plan's evidence requirements?",
      options: [
        { id: "sufficient", label: "All declared evidence requirements are satisfied." },
        { id: "insufficient", label: "At least one evidence requirement is unsatisfied." },
      ],
      chosenOptionId: coverage.sufficient ? "sufficient" : "insufficient",
      reason: `${coverage.satisfiedCount}/${coverage.requirementCount} requirement(s) satisfied; ${coverage.verifiedArtifactCount} verified artifact(s).`,
      confidence: 1,
      authority: "policy",
      reversible: true,
    });

    const meaningfulVerifiedArtifactCount = artifacts.filter(
      (artifact) => artifact.verified && artifact.kind !== "url",
    ).length;

    const gate = computeGate({
      plan: input.plan,
      execution,
      stepResults,
      assertions,
      coverage,
      requirementResults,
      meaningfulVerifiedArtifactCount,
    });

    decisions.push({
      decisionId: decisionId("capture-gate"),
      runId: context.runId,
      createdAt: nowIso(),
      engine: this.name,
      question: "What is the Browser Capture Gate status?",
      options: [
        { id: "pass", label: "Launched, in-origin, all critical assertions/requirements satisfied, verified evidence exists." },
        { id: "conditional", label: "Capture completed but some non-critical step/assertion/requirement is incomplete." },
        { id: "fail", label: "Capture cannot be trusted: launch failure, safety violation, critical failure, or no verified evidence." },
      ],
      chosenOptionId: gate.status,
      reason:
        gate.blockingReasons.length > 0
          ? gate.blockingReasons.join(" ")
          : gate.warnings.length > 0
            ? gate.warnings.join(" ")
            : "All Capture Gate requirements are satisfied.",
      confidence: 1,
      authority: "policy",
      reversible: true,
    });

    const evidenceManifest: BrowserEvidenceManifest = {
      schemaVersion: "0.1",
      capturePlanId: input.plan.id,
      targetId: input.plan.target.id,
      runId: context.runId,
      artifacts,
      assertions,
      observations: observationTimelineObservations,
      coverage,
      unresolvedRequirements,
    };

    const result: BrowserCaptureResult = {
      schemaVersion: "0.1",
      capturePlanId: input.plan.id,
      targetId: input.plan.target.id,
      launch: execution.launch,
      finalUrl: execution.finalUrl,
      durationMs: execution.durationMs,
      stepResults,
      assertions,
      screenshots: execution.screenshots,
      domSnapshots: execution.domSnapshots,
      consoleRecords: execution.consoleRecords,
      networkRecords: execution.networkRecords,
      safetyViolations: execution.safetyViolations,
      evidenceManifest,
      observationTimeline: { schemaVersion: "0.1", sourceId: input.plan.target.id, observations: observationTimelineObservations },
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

    return result;
  }

  decisionsFromLastRun(): readonly DecisionRecord[] {
    return this.lastDecisions;
  }

  verify(output: BrowserCaptureResult): VerificationResult {
    if (output.gate.status === "fail") {
      return {
        ok: false,
        issues: output.gate.blockingReasons.map((message) => ({ path: "gate", code: "capture-gate-failed", message })),
      };
    }
    return { ok: true, score: output.evidenceManifest.coverage.coverageRatio };
  }

  metrics(): EngineMetrics {
    return this.lastMetrics;
  }
}
