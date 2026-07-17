import type { BrowserSelector } from "./browser-selector.js";

export type BrowserScreenshotArtifact = {
  readonly id: string;
  readonly stepId: string;
  readonly path: string;
  readonly fileName: string;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly fullPage: boolean;
  readonly selector: BrowserSelector | null;
  readonly contentHash: string;
  readonly capturedAt: string;
  readonly maskedSelectorCount: number;
};

export type BrowserDomSnapshotArtifact = {
  readonly id: string;
  readonly stepId: string;
  readonly path: string;
  readonly fileName: string;
  readonly contentHash: string;
  readonly rootSelector: BrowserSelector | null;
  readonly sanitization: {
    readonly scriptsRemoved: number;
    readonly sensitiveFieldsRedacted: number;
    readonly commentsRemoved: number;
  };
};

export type BrowserConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export type BrowserConsoleRecord = {
  readonly id: string;
  readonly level: BrowserConsoleLevel;
  /** Truncated; never includes fill values or other sensitive step data. */
  readonly message: string;
  readonly observedAtMs: number;
};

export type BrowserSafetyViolationKind =
  | "external-navigation-blocked"
  | "popup-blocked"
  | "download-blocked"
  | "permission-denied"
  | "sensitive-value-exposure"
  | "resource-blocked"
  | "origin-disallowed";

export type BrowserSafetyViolation = {
  readonly id: string;
  readonly kind: BrowserSafetyViolationKind;
  readonly message: string;
  readonly stepId: string | null;
};

export type BrowserStepStatus = "completed" | "failed" | "skipped" | "timeout";

export type BrowserStepResult = {
  readonly stepId: string;
  readonly kind: string;
  readonly status: BrowserStepStatus;
  readonly message: string;
  readonly startedAtSeconds: number;
  readonly endedAtSeconds: number;
  readonly blocking: boolean;
};
