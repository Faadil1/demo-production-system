import type { ValidationIssue, ValidationResult } from "./types.js";
import type { BrowserSelector } from "./browser-selector.js";
import { validateSelector } from "./browser-selector.js";
import type { BrowserAssertionKind } from "./browser-assertion.js";
import { validateRegexPattern } from "./browser-assertion.js";
import type { BrowserCapturePolicy } from "./browser-capture-policy.js";
import { validateCapturePolicy } from "./browser-capture-policy.js";
import type { BrowserTarget } from "./browser-target.js";
import { originOf, validateBrowserTarget } from "./browser-target.js";

export type BrowserWaitUntil = "domcontentloaded" | "load" | "networkidle";

type StepBase = {
  readonly id: string;
  readonly description: string;
  readonly timeoutMs?: number;
  readonly continueOnFailure?: boolean;
  readonly sensitive?: boolean;
};

export type NavigateStep = StepBase & {
  readonly kind: "navigate";
  readonly path?: string;
  readonly url?: string;
  readonly waitUntil: BrowserWaitUntil;
};

export type ClickStep = StepBase & {
  readonly kind: "click";
  readonly selector: BrowserSelector;
  readonly expectedNavigation?: boolean;
  readonly button?: "left" | "right";
  readonly clickCount?: number;
};

export type FillValueSource = "literal" | "fixture";
export type FillRedactionPolicy = "mask" | "omit";

export type FillStep = StepBase & {
  readonly kind: "fill";
  readonly selector: BrowserSelector;
  readonly value: string;
  readonly valueSource: FillValueSource;
  readonly redactionPolicy?: FillRedactionPolicy;
};

export type SelectStep = StepBase & {
  readonly kind: "select";
  readonly selector: BrowserSelector;
  readonly value: string;
};

export const ALLOWED_PRESS_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Delete",
  "Space",
] as const;
export type BrowserAllowedKey = (typeof ALLOWED_PRESS_KEYS)[number];

export type PressStep = StepBase & {
  readonly kind: "press";
  readonly selector?: BrowserSelector;
  readonly key: BrowserAllowedKey;
};

export type WaitForCondition =
  | { readonly type: "selector-visible"; readonly selector: BrowserSelector }
  | { readonly type: "selector-hidden"; readonly selector: BrowserSelector }
  | { readonly type: "url"; readonly value: string }
  | { readonly type: "load-state"; readonly value: BrowserWaitUntil }
  | { readonly type: "timeout"; readonly durationMs: number };

export type WaitForStep = StepBase & {
  readonly kind: "wait-for";
  readonly condition: WaitForCondition;
};

export type AssertStep = StepBase & {
  readonly kind: "assert";
  readonly assertionKind: BrowserAssertionKind;
  readonly selector?: BrowserSelector;
  readonly attribute?: string;
  readonly expected?: string | number | boolean;
  readonly importance: "supporting" | "important" | "critical";
};

export type ScreenshotStep = StepBase & {
  readonly kind: "screenshot";
  readonly artifactName: string;
  readonly fullPage: boolean;
  readonly selector?: BrowserSelector;
  readonly maskSelectors?: readonly BrowserSelector[];
  readonly omitBackground?: boolean;
  readonly animations: "disabled" | "allow";
};

export type DomSnapshotStep = StepBase & {
  readonly kind: "dom-snapshot";
  readonly artifactName: string;
  readonly selector?: BrowserSelector;
  readonly sanitize: true;
};

export type BrowserCaptureStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | SelectStep
  | PressStep
  | WaitForStep
  | AssertStep
  | ScreenshotStep
  | DomSnapshotStep;

export type BrowserViewport = {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor?: number;
  readonly isMobile?: boolean;
};

export type BrowserEvidenceRequirementArtifactKind = "screenshot" | "dom-snapshot" | "assertion" | "url";

export type BrowserEvidenceRequirement = {
  readonly id: string;
  readonly claim: string;
  readonly requiredArtifactKinds: readonly BrowserEvidenceRequirementArtifactKind[];
  readonly requiredAssertionIds: readonly string[];
  readonly minimumVerifiedArtifacts: number;
  readonly importance: "supporting" | "important" | "critical";
};

export type BrowserCapturePlan = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly target: BrowserTarget;
  readonly viewport: BrowserViewport;
  readonly policy: BrowserCapturePolicy;
  readonly steps: readonly BrowserCaptureStep[];
  readonly evidenceRequirements: readonly BrowserEvidenceRequirement[];
};

const ARTIFACT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function validateArtifactName(name: string, path: string): ValidationIssue[] {
  if (!ARTIFACT_NAME_PATTERN.test(name)) {
    return [
      {
        path,
        code: "invalid-artifact-name",
        message: `Artifact name "${name}" must match ${ARTIFACT_NAME_PATTERN} (no path separators or traversal).`,
      },
    ];
  }
  return [];
}

/**
 * Full, deterministic validation of a capture plan: target, policy, viewport bounds,
 * step count, unique step IDs, per-step selector/key/artifact-name rules, and
 * navigation-origin restrictions. This is pure structural/safety validation — it never
 * touches a browser.
 */
export function validateCapturePlan(plan: BrowserCapturePlan): ValidationResult {
  const issues: ValidationIssue[] = [];

  const targetResult = validateBrowserTarget(plan.target, plan.policy);
  if (!targetResult.ok) issues.push(...targetResult.issues);

  const policyResult = validateCapturePolicy(plan.policy);
  if (!policyResult.ok) issues.push(...policyResult.issues);

  const { width, height, deviceScaleFactor } = plan.viewport;
  if (width < 320 || width > 3840) {
    issues.push({ path: "viewport/width", code: "out-of-bounds", message: "viewport.width must be between 320 and 3840." });
  }
  if (height < 480 || height > 2160) {
    issues.push({ path: "viewport/height", code: "out-of-bounds", message: "viewport.height must be between 480 and 2160." });
  }
  if (deviceScaleFactor !== undefined && (deviceScaleFactor < 1 || deviceScaleFactor > 3)) {
    issues.push({ path: "viewport/deviceScaleFactor", code: "out-of-bounds", message: "viewport.deviceScaleFactor must be between 1 and 3." });
  }

  if (plan.steps.length === 0) {
    issues.push({ path: "steps", code: "empty", message: "A capture plan must declare at least one step." });
  }
  if (plan.steps.length > plan.policy.maximumSteps) {
    issues.push({
      path: "steps",
      code: "too-many-steps",
      message: `Plan declares ${plan.steps.length} steps, exceeding policy.maximumSteps (${plan.policy.maximumSteps}).`,
    });
  }

  const seenIds = new Set<string>();
  const targetOrigin = (() => {
    try {
      return originOf(plan.target.baseUrl);
    } catch {
      return null;
    }
  })();

  plan.steps.forEach((step, index) => {
    const p = `steps/${index}`;
    if (seenIds.has(step.id)) {
      issues.push({ path: `${p}/id`, code: "duplicate-id", message: `Duplicate step id "${step.id}".` });
    }
    seenIds.add(step.id);

    switch (step.kind) {
      case "navigate": {
        if (!step.path && !step.url) {
          issues.push({ path: `${p}`, code: "missing-destination", message: "A navigate step requires either `path` or `url`." });
        }
        if (step.path && step.url) {
          issues.push({ path: `${p}`, code: "ambiguous-destination", message: "A navigate step must not declare both `path` and `url`." });
        }
        if (step.url) {
          let destinationOrigin: string | null = null;
          try {
            destinationOrigin = originOf(step.url);
          } catch {
            issues.push({ path: `${p}/url`, code: "invalid-url", message: "navigate.url must be a valid absolute URL." });
          }
          if (destinationOrigin && destinationOrigin !== targetOrigin) {
            const allowed = plan.policy.allowExternalNavigation && plan.policy.allowedOrigins.includes(destinationOrigin);
            if (!allowed) {
              issues.push({
                path: `${p}/url`,
                code: "origin-not-allowed",
                message: `navigate.url origin "${destinationOrigin}" is outside the target origin and is not allowlisted for external navigation.`,
              });
            }
          }
        }
        break;
      }
      case "click": {
        const selectorResult = validateSelector(step.selector, `${p}/selector`);
        if (!selectorResult.ok) issues.push(...selectorResult.issues);
        if (step.button === "right") {
          issues.push({ path: `${p}/button`, code: "right-click-disabled", message: "Right-click is disabled in the reference implementation." });
        }
        if (step.clickCount !== undefined && step.clickCount !== 1) {
          issues.push({ path: `${p}/clickCount`, code: "multi-click-disabled", message: "clickCount other than 1 is disabled in the reference implementation." });
        }
        break;
      }
      case "fill": {
        const selectorResult = validateSelector(step.selector, `${p}/selector`);
        if (!selectorResult.ok) issues.push(...selectorResult.issues);
        break;
      }
      case "select": {
        const selectorResult = validateSelector(step.selector, `${p}/selector`);
        if (!selectorResult.ok) issues.push(...selectorResult.issues);
        break;
      }
      case "press": {
        if (step.selector) {
          const selectorResult = validateSelector(step.selector, `${p}/selector`);
          if (!selectorResult.ok) issues.push(...selectorResult.issues);
        }
        if (!(ALLOWED_PRESS_KEYS as readonly string[]).includes(step.key)) {
          issues.push({ path: `${p}/key`, code: "key-not-allowed", message: `Key "${step.key}" is not in the documented allowlist.` });
        }
        break;
      }
      case "wait-for": {
        if (step.condition.type === "selector-visible" || step.condition.type === "selector-hidden") {
          const selectorResult = validateSelector(step.condition.selector, `${p}/condition/selector`);
          if (!selectorResult.ok) issues.push(...selectorResult.issues);
        }
        break;
      }
      case "assert": {
        if (step.selector) {
          const selectorResult = validateSelector(step.selector, `${p}/selector`);
          if (!selectorResult.ok) issues.push(...selectorResult.issues);
        }
        if (step.assertionKind === "url-matches" && typeof step.expected === "string") {
          const regexResult = validateRegexPattern(step.expected);
          if (!regexResult.ok) issues.push(...regexResult.issues.map((issue) => ({ ...issue, path: `${p}/${issue.path}` })));
        }
        break;
      }
      case "screenshot": {
        issues.push(...validateArtifactName(step.artifactName, `${p}/artifactName`));
        if (step.selector) {
          const selectorResult = validateSelector(step.selector, `${p}/selector`);
          if (!selectorResult.ok) issues.push(...selectorResult.issues);
        }
        for (const [maskIndex, maskSelector] of (step.maskSelectors ?? []).entries()) {
          const selectorResult = validateSelector(maskSelector, `${p}/maskSelectors/${maskIndex}`);
          if (!selectorResult.ok) issues.push(...selectorResult.issues);
        }
        break;
      }
      case "dom-snapshot": {
        issues.push(...validateArtifactName(step.artifactName, `${p}/artifactName`));
        if (step.sanitize !== true) {
          issues.push({ path: `${p}/sanitize`, code: "sanitize-required", message: "dom-snapshot steps must declare sanitize: true." });
        }
        if (step.selector) {
          const selectorResult = validateSelector(step.selector, `${p}/selector`);
          if (!selectorResult.ok) issues.push(...selectorResult.issues);
        }
        break;
      }
    }
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
