import type { ValidationResult } from "./types.js";

export type BrowserResourceType =
  | "document"
  | "stylesheet"
  | "image"
  | "media"
  | "font"
  | "script"
  | "xhr"
  | "fetch"
  | "websocket"
  | "eventsource"
  | "manifest"
  | "other";

export type BrowserCapturePolicy = {
  readonly schemaVersion: "0.1";
  readonly allowedOrigins: readonly string[];
  readonly allowExternalNavigation: boolean;
  readonly allowDownloads: boolean;
  readonly allowPopups: boolean;
  readonly allowClipboard: boolean;
  readonly allowGeolocation: boolean;
  readonly allowNotifications: boolean;
  readonly allowCamera: boolean;
  readonly allowMicrophone: boolean;
  readonly allowServiceWorkers: boolean;
  readonly allowFileUploads: boolean;
  readonly blockThirdPartyRequests: boolean;
  readonly blockedResourceTypes: readonly BrowserResourceType[];
  readonly blockedUrlPatterns: readonly string[];
  readonly maximumSteps: number;
  readonly maximumDurationMs: number;
  readonly defaultStepTimeoutMs: number;
};

/** Safe-by-default policy: nothing external, nothing intrusive, tightly bounded. */
export const DEFAULT_BROWSER_CAPTURE_POLICY: BrowserCapturePolicy = {
  schemaVersion: "0.1",
  allowedOrigins: [],
  allowExternalNavigation: false,
  allowDownloads: false,
  allowPopups: false,
  allowClipboard: false,
  allowGeolocation: false,
  allowNotifications: false,
  allowCamera: false,
  allowMicrophone: false,
  allowServiceWorkers: false,
  allowFileUploads: false,
  blockThirdPartyRequests: true,
  blockedResourceTypes: [],
  blockedUrlPatterns: [],
  maximumSteps: 100,
  maximumDurationMs: 5 * 60 * 1000,
  defaultStepTimeoutMs: 10_000,
};

const MAX_STEPS_CEILING = 500;
const MAX_DURATION_CEILING_MS = 30 * 60 * 1000;

export function validateCapturePolicy(policy: BrowserCapturePolicy): ValidationResult {
  const issues: { path: string; code: string; message: string }[] = [];

  if (policy.maximumSteps < 1 || policy.maximumSteps > MAX_STEPS_CEILING) {
    issues.push({
      path: "maximumSteps",
      code: "out-of-bounds",
      message: `maximumSteps must be between 1 and ${MAX_STEPS_CEILING}.`,
    });
  }
  if (policy.maximumDurationMs < 1000 || policy.maximumDurationMs > MAX_DURATION_CEILING_MS) {
    issues.push({
      path: "maximumDurationMs",
      code: "out-of-bounds",
      message: `maximumDurationMs must be between 1000 and ${MAX_DURATION_CEILING_MS}.`,
    });
  }
  if (policy.defaultStepTimeoutMs < 100 || policy.defaultStepTimeoutMs > policy.maximumDurationMs) {
    issues.push({
      path: "defaultStepTimeoutMs",
      code: "out-of-bounds",
      message: "defaultStepTimeoutMs must be between 100ms and maximumDurationMs.",
    });
  }
  if (policy.allowExternalNavigation && policy.allowedOrigins.length === 0) {
    issues.push({
      path: "allowedOrigins",
      code: "external-navigation-without-allowlist",
      message: "allowExternalNavigation is true but allowedOrigins is empty; nothing would actually be permitted.",
    });
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
