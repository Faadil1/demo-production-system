import type { DemoObservationTimeline } from "./demo-observation.js";
import type { BrowserAssertionResult } from "./browser-assertion.js";
import type {
  BrowserConsoleRecord,
  BrowserDomSnapshotArtifact,
  BrowserSafetyViolation,
  BrowserScreenshotArtifact,
  BrowserStepResult,
} from "./browser-capture-artifacts.js";
import type { BrowserNetworkRecord } from "./browser-network.js";
import type { BrowserEvidenceManifest } from "./browser-evidence-manifest.js";

export type BrowserCaptureGateStatus = "pass" | "conditional" | "fail";

export type BrowserCaptureGate = {
  readonly name: "browser-capture";
  readonly status: BrowserCaptureGateStatus;
  readonly blockingReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly requirementsBeforeUse: readonly string[];
};

export type BrowserLaunchInfo = {
  readonly launched: boolean;
  readonly browserName: string;
  readonly browserVersion: string | null;
  readonly failureReason: string | null;
};

export type BrowserCaptureResult = {
  readonly schemaVersion: "0.1";
  readonly capturePlanId: string;
  readonly targetId: string;
  readonly launch: BrowserLaunchInfo;
  readonly finalUrl: string | null;
  readonly durationMs: number;
  readonly stepResults: readonly BrowserStepResult[];
  readonly assertions: readonly BrowserAssertionResult[];
  readonly screenshots: readonly BrowserScreenshotArtifact[];
  readonly domSnapshots: readonly BrowserDomSnapshotArtifact[];
  readonly consoleRecords: readonly BrowserConsoleRecord[];
  readonly networkRecords: readonly BrowserNetworkRecord[];
  readonly safetyViolations: readonly BrowserSafetyViolation[];
  readonly evidenceManifest: BrowserEvidenceManifest;
  readonly observationTimeline: DemoObservationTimeline;
  readonly gate: BrowserCaptureGate;
};
