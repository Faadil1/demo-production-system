import type { EngineContext } from "../core/engine.js";
import type { BrowserCapturePlan } from "../core/browser-capture-plan.js";
import type { BrowserAssertionKind } from "../core/browser-assertion.js";
import type {
  BrowserConsoleRecord,
  BrowserDomSnapshotArtifact,
  BrowserSafetyViolation,
  BrowserScreenshotArtifact,
  BrowserStepStatus,
} from "../core/browser-capture-artifacts.js";
import type { BrowserNetworkRecord } from "../core/browser-network.js";
import type { BrowserLaunchInfo } from "../core/browser-capture-result.js";

export type BrowserStepExecutionResult = {
  readonly stepId: string;
  readonly kind: string;
  readonly status: BrowserStepStatus;
  readonly message: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly blocking: boolean;
};

/**
 * The adapter reports only what it *observed* (`actual`) — it never decides pass/fail.
 * That comparison against the plan's declared `expected` is pure domain logic performed
 * by BrowserCaptureEngine (via `evaluateAssertion`), which is what keeps the gate/scoring
 * logic testable without a real browser.
 */
export type BrowserAssertionObservation = {
  readonly assertionId: string;
  readonly stepId: string;
  readonly kind: BrowserAssertionKind;
  readonly actual: unknown;
  readonly observedAtMs: number;
  readonly relatedArtifactIds: readonly string[];
  readonly sensitive?: boolean;
  readonly error?: string;
};

export type BrowserAdapterExecution = {
  readonly launch: BrowserLaunchInfo;
  readonly finalUrl: string | null;
  readonly durationMs: number;
  readonly stepResults: readonly BrowserStepExecutionResult[];
  readonly assertionObservations: readonly BrowserAssertionObservation[];
  readonly screenshots: readonly BrowserScreenshotArtifact[];
  readonly domSnapshots: readonly BrowserDomSnapshotArtifact[];
  readonly consoleRecords: readonly BrowserConsoleRecord[];
  readonly networkRecords: readonly BrowserNetworkRecord[];
  readonly safetyViolations: readonly BrowserSafetyViolation[];
};

export type BrowserAdapterExecuteOptions = {
  readonly screenshotsDir: string;
  readonly domDir: string;
};

/**
 * Replaceable interface for browser capture backends. Implementations must never
 * mutate the plan, must enforce the plan's own BrowserCapturePolicy, and must return a
 * structured BrowserAdapterExecution even on failure (browser unavailable, timeout,
 * crash) rather than throwing.
 */
export interface BrowserAdapter {
  readonly name: string;
  readonly version: string;

  execute(
    plan: BrowserCapturePlan,
    context: EngineContext,
    options: BrowserAdapterExecuteOptions,
  ): Promise<BrowserAdapterExecution>;
}
