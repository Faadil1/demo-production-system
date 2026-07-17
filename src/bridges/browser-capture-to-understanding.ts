import type { EvidenceItem } from "../core/product-understanding.js";
import type { BrowserCapturePlan } from "../core/browser-capture-plan.js";
import type { BrowserCaptureResult } from "../core/browser-capture-result.js";
import type { DemoObservationTimeline } from "../core/demo-observation.js";

export type BrowserCaptureUnderstandingEvidence = {
  readonly schemaVersion: "0.1";
  readonly sourceCapturePlanId: string;
  readonly sourceRunId: string;
  readonly evidence: readonly EvidenceItem[];
  readonly observations: DemoObservationTimeline;
};

/**
 * Deterministically converts VERIFIED browser capture evidence into RFC-0002-shaped
 * EvidenceItem entries. This is a one-way, read-only bridge:
 *
 *  - Only a passed assertion, or an existing screenshot/DOM-snapshot artifact, ever
 *    becomes an EvidenceItem — and it is always marked "verified", because by this
 *    point the underlying fact (pixels were captured / an assertion passed) really was
 *    observed by the adapter. This does NOT mean a business claim is proven — RFC-0004
 *    Core Principle 5 still applies: a screenshot is evidence that pixels were
 *    captured, not that a product claim is true. The `claim` text on each EvidenceItem
 *    is phrased accordingly ("... was captured" / "... passed"), never as a business
 *    outcome statement.
 *  - A satisfied BrowserEvidenceRequirement becomes one additional EvidenceItem per
 *    requirement, carrying the requirement's own declared claim text and importance,
 *    referencing the assertions that satisfied it. Unsatisfied requirements (listed in
 *    `evidenceManifest.unresolvedRequirements`) are never bridged.
 *  - This function never mutates or rewrites an existing ProductUnderstanding
 *    artifact — its output is a separate, independent artifact for a future
 *    orchestration step to consume. This establishes the path for a future
 *    Understanding Gate to reach PASS once real verified evidence exists.
 */
export function bridgeBrowserCaptureToUnderstanding(
  plan: BrowserCapturePlan,
  result: BrowserCaptureResult,
  runId: string,
): BrowserCaptureUnderstandingEvidence {
  const evidence: EvidenceItem[] = [];

  for (const assertion of result.assertions) {
    if (assertion.status !== "passed") continue;
    evidence.push({
      id: `capture-evidence-assertion-${assertion.assertionId}`,
      kind: "capture",
      claim: `Assertion "${assertion.assertionId}" (${assertion.kind}) passed during browser capture.`,
      source: `browser-capture://${result.capturePlanId}/assertions/${assertion.assertionId}`,
      importance: "supporting",
      verificationStatus: "verified",
      supportsClaimIds: [],
    });
  }

  for (const screenshot of result.screenshots) {
    evidence.push({
      id: `capture-evidence-screenshot-${screenshot.id}`,
      kind: "capture",
      claim: `A screenshot was captured at step "${screenshot.stepId}" (pixels captured; not itself proof of a product claim).`,
      source: `browser-capture://${result.capturePlanId}/screenshots/${screenshot.id}`,
      importance: "supporting",
      verificationStatus: "verified",
      supportsClaimIds: [],
    });
  }

  for (const snapshot of result.domSnapshots) {
    evidence.push({
      id: `capture-evidence-dom-${snapshot.id}`,
      kind: "capture",
      claim: `A sanitized DOM snapshot was captured at step "${snapshot.stepId}".`,
      source: `browser-capture://${result.capturePlanId}/dom-snapshots/${snapshot.id}`,
      importance: "supporting",
      verificationStatus: "verified",
      supportsClaimIds: [],
    });
  }

  const unresolvedRequirementIds = new Set(
    result.evidenceManifest.unresolvedRequirements.map((requirement) => requirement.requirementId),
  );
  for (const requirement of plan.evidenceRequirements) {
    if (unresolvedRequirementIds.has(requirement.id)) continue;
    evidence.push({
      id: `capture-evidence-requirement-${requirement.id}`,
      kind: "capture",
      claim: `Evidence requirement satisfied: ${requirement.claim}`,
      source: `browser-capture://${result.capturePlanId}/evidence-requirements/${requirement.id}`,
      importance: requirement.importance,
      verificationStatus: "verified",
      supportsClaimIds: requirement.requiredAssertionIds,
    });
  }

  return {
    schemaVersion: "0.1",
    sourceCapturePlanId: result.capturePlanId,
    sourceRunId: runId,
    evidence,
    observations: result.observationTimeline,
  };
}
