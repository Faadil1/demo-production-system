import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Route } from "playwright";
import type { EngineContext } from "../core/engine.js";
import type {
  BrowserCapturePlan,
  BrowserCaptureStep,
  WaitForCondition,
} from "../core/browser-capture-plan.js";
import type { BrowserSelector } from "../core/browser-selector.js";
import { originOf } from "../core/browser-target.js";
import { classifyOriginRelationship, sanitizeUrl, type BrowserNetworkRecord } from "../core/browser-network.js";
import type { BrowserResourceType } from "../core/browser-capture-policy.js";
import { sanitizeDomSnapshot } from "../core/dom-sanitizer.js";
import type {
  BrowserConsoleLevel,
  BrowserConsoleRecord,
  BrowserDomSnapshotArtifact,
  BrowserSafetyViolation,
  BrowserScreenshotArtifact,
} from "../core/browser-capture-artifacts.js";
import type {
  BrowserAdapter,
  BrowserAdapterExecuteOptions,
  BrowserAdapterExecution,
  BrowserAssertionObservation,
  BrowserStepExecutionResult,
} from "./browser-adapter.js";

function sha256HexOfBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function mapResourceType(playwrightResourceType: string): BrowserResourceType {
  switch (playwrightResourceType) {
    case "document":
    case "stylesheet":
    case "image":
    case "media":
    case "font":
    case "script":
    case "xhr":
    case "fetch":
    case "websocket":
    case "eventsource":
    case "manifest":
      return playwrightResourceType;
    default:
      return "other";
  }
}

function toLocator(page: Page, selector: BrowserSelector): Locator {
  switch (selector.strategy) {
    case "test-id":
      return page.getByTestId(selector.value);
    case "role":
      return page.getByRole(selector.role as Parameters<Page["getByRole"]>[0], selector.name ? { name: selector.name } : undefined);
    case "label":
      return page.getByLabel(selector.value);
    case "text":
      return page.getByText(selector.value, { exact: selector.exact ?? false });
    case "css":
      return page.locator(selector.value);
  }
}

async function nextFreeFileName(dir: string, baseName: string, extension: string): Promise<{ fileName: string; path: string }> {
  const fileName = `${baseName}${extension}`;
  return { fileName, path: path.join(dir, fileName) };
}

type Sink = {
  readonly screenshots: BrowserScreenshotArtifact[];
  readonly domSnapshots: BrowserDomSnapshotArtifact[];
  readonly assertionObservations: BrowserAssertionObservation[];
  readonly safetyViolations: BrowserSafetyViolation[];
};

function stepResult(
  step: BrowserCaptureStep,
  status: BrowserStepExecutionResult["status"],
  message: string,
  startedAtMs: number,
  endedAtMs: number,
): BrowserStepExecutionResult {
  return {
    stepId: step.id,
    kind: step.kind,
    status,
    message,
    startedAtMs,
    endedAtMs,
    blocking: !step.continueOnFailure,
  };
}

/**
 * Reference BrowserAdapter using Playwright Chromium. Every capture uses a fresh
 * isolated browser context (never a persistent user profile), denies all permissions,
 * never persists cookies/storage state, and is closed (page/context/browser) in a
 * finally block even on failure. Never bypasses HTTPS errors, never uses stealth
 * plugins, never exposes Node integration to page content.
 */
export class PlaywrightBrowserAdapter implements BrowserAdapter {
  readonly name = "playwright-browser-adapter";
  readonly version = "0.1.0";

  async execute(
    plan: BrowserCapturePlan,
    _context: EngineContext,
    options: BrowserAdapterExecuteOptions,
  ): Promise<BrowserAdapterExecution> {
    const startTime = Date.now();
    const elapsed = () => Date.now() - startTime;

    const consoleRecords: BrowserConsoleRecord[] = [];
    const networkRecords: BrowserNetworkRecord[] = [];
    const sink: Sink = { screenshots: [], domSnapshots: [], assertionObservations: [], safetyViolations: [] };
    const stepResults: BrowserStepExecutionResult[] = [];

    const targetOrigin = originOf(plan.target.baseUrl);
    const allowedOrigins = new Set([
      targetOrigin,
      ...(plan.policy.allowExternalNavigation ? plan.policy.allowedOrigins : []),
    ]);

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let launched = false;
    let launchFailureReason: string | null = null;
    let browserVersion: string | null = null;
    let finalUrl: string | null = null;
    let networkCounter = 0;
    let consoleCounter = 0;

    await mkdir(options.screenshotsDir, { recursive: true });
    await mkdir(options.domDir, { recursive: true });

    try {
      browser = await chromium.launch({ headless: true });
      launched = true;
      browserVersion = browser.version();

      context = await browser.newContext({
        viewport: { width: plan.viewport.width, height: plan.viewport.height },
        deviceScaleFactor: plan.viewport.deviceScaleFactor ?? 1,
        isMobile: plan.viewport.isMobile ?? false,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "reduce",
        permissions: [],
        acceptDownloads: plan.policy.allowDownloads,
        ignoreHTTPSErrors: false,
        javaScriptEnabled: true,
      });

      page = await context.newPage();
      const activePage = page;

      // BrowserContext's "page" event fires for every new page in the context,
      // including the primary page just created above via context.newPage() — so the
      // primary page must be explicitly excluded, or this would close itself instantly.
      context.on("page", (candidate) => {
        if (candidate === activePage) return;
        if (!plan.policy.allowPopups) {
          sink.safetyViolations.push({
            id: `safety-${sink.safetyViolations.length + 1}`,
            kind: "popup-blocked",
            message: `A popup to "${candidate.url()}" was blocked by policy.`,
            stepId: null,
          });
          candidate.close().catch(() => undefined);
        }
      });

      activePage.on("console", (message) => {
        consoleCounter += 1;
        const rawLevel = message.type();
        const level: BrowserConsoleLevel = (["log", "info", "warn", "error", "debug"] as const).includes(
          rawLevel as BrowserConsoleLevel,
        )
          ? (rawLevel as BrowserConsoleLevel)
          : "log";
        consoleRecords.push({ id: `console-${consoleCounter}`, level, message: message.text().slice(0, 500), observedAtMs: elapsed() });
      });

      activePage.on("download", (download) => {
        if (!plan.policy.allowDownloads) {
          sink.safetyViolations.push({
            id: `safety-${sink.safetyViolations.length + 1}`,
            kind: "download-blocked",
            message: `A download of "${download.suggestedFilename()}" was blocked by policy.`,
            stepId: null,
          });
          download.cancel().catch(() => undefined);
        }
      });

      await context.route("**/*", async (route: Route) => {
        const request = route.request();
        const url = request.url();
        const resourceType = mapResourceType(request.resourceType());
        const relationship = classifyOriginRelationship(url, targetOrigin);

        let blocked = false;
        if (relationship === "third-party" && plan.policy.blockThirdPartyRequests) blocked = true;
        if (plan.policy.blockedResourceTypes.includes(resourceType)) blocked = true;
        if (plan.policy.blockedUrlPatterns.some((pattern) => url.includes(pattern))) blocked = true;

        networkCounter += 1;
        networkRecords.push({
          id: `network-${networkCounter}`,
          url: sanitizeUrl(url),
          method: request.method(),
          resourceType,
          originRelationship: relationship,
          decision: blocked ? "blocked" : "allowed",
          statusCode: null,
          failureReason: null,
          timingMs: null,
        });

        if (blocked) {
          await route.abort("blockedbyclient").catch(() => undefined);
        } else {
          await route.continue().catch(() => undefined);
        }
      });

      let stopped = false;
      for (const step of plan.steps) {
        if (stopped || elapsed() > plan.policy.maximumDurationMs) {
          stepResults.push(stepResult(step, "skipped", "Skipped: preceding blocking failure or duration limit.", elapsed(), elapsed()));
          continue;
        }

        const stepStart = elapsed();
        try {
          await this.executeStep(activePage, plan, step, options, sink, allowedOrigins, startTime);

          const currentOrigin = (() => {
            try {
              return new URL(activePage.url()).origin;
            } catch {
              return null;
            }
          })();
          if (currentOrigin && !allowedOrigins.has(currentOrigin)) {
            sink.safetyViolations.push({
              id: `safety-${sink.safetyViolations.length + 1}`,
              kind: "origin-disallowed",
              message: `Navigation left the allowed origin set (now at "${currentOrigin}").`,
              stepId: step.id,
            });
            throw new Error(`Navigated outside allowed origins to "${currentOrigin}".`);
          }

          stepResults.push(stepResult(step, "completed", "Step completed.", stepStart, elapsed()));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const timedOut = /timeout/i.test(message);
          stepResults.push(stepResult(step, timedOut ? "timeout" : "failed", message.slice(0, 300), stepStart, elapsed()));
          if (!step.continueOnFailure) {
            stopped = true;
          }
        }
      }

      finalUrl = activePage.url();
    } catch (error) {
      launchFailureReason = error instanceof Error ? error.message : String(error);
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }

    return {
      launch: { launched, browserName: "chromium", browserVersion, failureReason: launchFailureReason },
      finalUrl,
      durationMs: elapsed(),
      stepResults,
      assertionObservations: sink.assertionObservations,
      screenshots: sink.screenshots,
      domSnapshots: sink.domSnapshots,
      consoleRecords,
      networkRecords,
      safetyViolations: sink.safetyViolations,
    };
  }

  private async executeStep(
    page: Page,
    plan: BrowserCapturePlan,
    step: BrowserCaptureStep,
    options: BrowserAdapterExecuteOptions,
    sink: Sink,
    allowedOrigins: ReadonlySet<string>,
    startTime: number,
  ): Promise<void> {
    const timeoutMs = step.timeoutMs ?? plan.policy.defaultStepTimeoutMs;
    const elapsed = () => Date.now() - startTime;

    switch (step.kind) {
      case "navigate": {
        const destination = step.url ?? new URL(step.path ?? "/", plan.target.baseUrl).toString();
        const destinationOrigin = originOf(destination);
        if (!allowedOrigins.has(destinationOrigin)) {
          sink.safetyViolations.push({
            id: `safety-${sink.safetyViolations.length + 1}`,
            kind: "external-navigation-blocked",
            message: `Navigation to "${destination}" was blocked: origin not allowed.`,
            stepId: step.id,
          });
          throw new Error(`Navigation to disallowed origin "${destinationOrigin}" was blocked.`);
        }
        await page.goto(destination, { waitUntil: step.waitUntil, timeout: timeoutMs });
        return;
      }
      case "click": {
        const locator = toLocator(page, step.selector);
        if (step.expectedNavigation) {
          await Promise.all([page.waitForLoadState("load", { timeout: timeoutMs }), locator.click({ timeout: timeoutMs })]);
        } else {
          await locator.click({ timeout: timeoutMs, button: "left", clickCount: 1 });
        }
        return;
      }
      case "fill": {
        const locator = toLocator(page, step.selector);
        await locator.fill(step.value, { timeout: timeoutMs });
        return;
      }
      case "select": {
        const locator = toLocator(page, step.selector);
        await locator.selectOption(step.value, { timeout: timeoutMs });
        return;
      }
      case "press": {
        if (step.selector) {
          await toLocator(page, step.selector).press(step.key, { timeout: timeoutMs });
        } else {
          await page.keyboard.press(step.key);
        }
        return;
      }
      case "wait-for": {
        await this.waitFor(page, step.condition, timeoutMs);
        return;
      }
      case "assert": {
        await this.observeAssertion(page, step, sink, elapsed());
        return;
      }
      case "screenshot": {
        await this.takeScreenshot(page, step, options, sink);
        return;
      }
      case "dom-snapshot": {
        await this.takeDomSnapshot(page, step, options, sink);
        return;
      }
    }
  }

  private async waitFor(page: Page, condition: WaitForCondition, timeoutMs: number): Promise<void> {
    switch (condition.type) {
      case "selector-visible":
        await toLocator(page, condition.selector).waitFor({ state: "visible", timeout: timeoutMs });
        return;
      case "selector-hidden":
        await toLocator(page, condition.selector).waitFor({ state: "hidden", timeout: timeoutMs });
        return;
      case "url":
        await page.waitForURL(condition.value, { timeout: timeoutMs });
        return;
      case "load-state":
        await page.waitForLoadState(condition.value, { timeout: timeoutMs });
        return;
      case "timeout":
        await page.waitForTimeout(condition.durationMs);
        return;
    }
  }

  private async observeAssertion(page: Page, step: Extract<BrowserCaptureStep, { kind: "assert" }>, sink: Sink, observedAtMs: number): Promise<void> {
    let actual: unknown = null;
    let error: string | undefined;
    const relatedArtifactIds: string[] = [];

    try {
      switch (step.assertionKind) {
        case "url-equals":
        case "url-matches":
          actual = page.url();
          break;
        case "title-equals":
          actual = await page.title();
          break;
        case "element-visible":
        case "element-hidden": {
          if (!step.selector) throw new Error("A selector is required for element visibility assertions.");
          actual = await toLocator(page, step.selector).isVisible();
          break;
        }
        case "text-equals":
        case "text-contains": {
          if (!step.selector) throw new Error("A selector is required for text assertions.");
          actual = ((await toLocator(page, step.selector).textContent()) ?? "").trim();
          break;
        }
        case "attribute-equals": {
          if (!step.selector || !step.attribute) throw new Error("A selector and attribute are required for attribute assertions.");
          actual = await toLocator(page, step.selector).getAttribute(step.attribute);
          break;
        }
        case "count-equals": {
          if (!step.selector) throw new Error("A selector is required for count assertions.");
          actual = await toLocator(page, step.selector).count();
          break;
        }
        case "value-equals": {
          if (!step.selector) throw new Error("A selector is required for value assertions.");
          actual = await toLocator(page, step.selector).inputValue();
          break;
        }
        case "screenshot-created": {
          actual = sink.screenshots.length > 0;
          break;
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message.slice(0, 300) : String(caught);
    }

    sink.assertionObservations.push({
      assertionId: step.id,
      stepId: step.id,
      kind: step.assertionKind,
      actual,
      observedAtMs,
      relatedArtifactIds,
      ...(step.sensitive !== undefined ? { sensitive: step.sensitive } : {}),
      ...(error ? { error } : {}),
    });
  }

  private async takeScreenshot(
    page: Page,
    step: Extract<BrowserCaptureStep, { kind: "screenshot" }>,
    options: BrowserAdapterExecuteOptions,
    sink: Sink,
  ): Promise<void> {
    const maskLocators = (step.maskSelectors ?? []).map((selector) => toLocator(page, selector));
    const shotOptions = {
      animations: step.animations,
      omitBackground: step.omitBackground ?? false,
      ...(maskLocators.length > 0 ? { mask: maskLocators } : {}),
    };

    let buffer: Buffer;
    if (step.selector) {
      buffer = await toLocator(page, step.selector).screenshot(shotOptions);
    } else {
      buffer = await page.screenshot({ ...shotOptions, fullPage: step.fullPage });
    }

    const { fileName, path: filePath } = await nextFreeFileName(options.screenshotsDir, step.artifactName, ".png");
    await writeFile(filePath, buffer);

    const viewportSize = page.viewportSize();
    sink.screenshots.push({
      id: `screenshot-${step.id}`,
      stepId: step.id,
      path: filePath,
      fileName,
      mimeType: "image/png",
      width: viewportSize?.width ?? 0,
      height: viewportSize?.height ?? 0,
      fullPage: step.fullPage,
      selector: step.selector ?? null,
      contentHash: sha256HexOfBuffer(buffer),
      capturedAt: new Date().toISOString(),
      maskedSelectorCount: maskLocators.length,
    });
  }

  private async takeDomSnapshot(
    page: Page,
    step: Extract<BrowserCaptureStep, { kind: "dom-snapshot" }>,
    options: BrowserAdapterExecuteOptions,
    sink: Sink,
  ): Promise<void> {
    const html = step.selector
      ? await toLocator(page, step.selector).evaluate((element) => element.outerHTML)
      : await page.content();

    const sanitized = sanitizeDomSnapshot(html);
    const { fileName, path: filePath } = await nextFreeFileName(options.domDir, step.artifactName, ".html");
    await writeFile(filePath, sanitized.sanitizedHtml, "utf8");

    sink.domSnapshots.push({
      id: `dom-${step.id}`,
      stepId: step.id,
      path: filePath,
      fileName,
      contentHash: sha256HexOfBuffer(Buffer.from(sanitized.sanitizedHtml, "utf8")),
      rootSelector: step.selector ?? null,
      sanitization: {
        scriptsRemoved: sanitized.scriptsRemoved,
        sensitiveFieldsRedacted: sanitized.sensitiveFieldsRedacted,
        commentsRemoved: sanitized.commentsRemoved,
      },
    });
  }
}
