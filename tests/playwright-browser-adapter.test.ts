import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { PlaywrightBrowserAdapter } from "../src/adapters/playwright-browser-adapter.js";
import type { BrowserCapturePlan, BrowserCaptureStep } from "../src/core/browser-capture-plan.js";
import { DEFAULT_BROWSER_CAPTURE_POLICY } from "../src/core/browser-capture-policy.js";

const PAGE_HTML = `<!doctype html><html><head><title>Fixture</title></head><body>
<h1 data-testid="title">Hello</h1>
<button data-testid="btn" onclick="document.querySelector('[data-testid=result]').style.display='block'">Go</button>
<div data-testid="result" style="display:none">Done</div>
</body></html>`;

let server: Server;
let baseUrl: string;

// Must resolve before describe.skipIf() is evaluated during test collection, so this is
// a top-level await rather than something set inside beforeAll (which runs too late).
let chromiumAvailable = true;
try {
  const probe = await chromium.launch({ headless: true });
  await probe.close();
} catch {
  chromiumAvailable = false;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE_HTML);
    });
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const context = { runId: "run-test", now: () => new Date() };

function plan(steps: readonly BrowserCaptureStep[]): BrowserCapturePlan {
  return {
    schemaVersion: "0.1",
    id: "plan-adapter-test",
    target: { schemaVersion: "0.1", id: "t1", type: "local", baseUrl },
    viewport: { width: 1024, height: 768 },
    policy: DEFAULT_BROWSER_CAPTURE_POLICY,
    steps,
    evidenceRequirements: [],
  };
}

describe.skipIf(!chromiumAvailable)("PlaywrightBrowserAdapter (real Chromium integration)", () => {
  it("navigates, clicks, asserts, and screenshots against a real local page", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "dps-playwright-"));
    try {
      const steps: BrowserCaptureStep[] = [
        { id: "nav", kind: "navigate", description: "Navigate.", path: "/", waitUntil: "load" },
        {
          id: "assert-title",
          kind: "assert",
          description: "Assert title visible.",
          assertionKind: "element-visible",
          selector: { strategy: "test-id", value: "title" },
          importance: "important",
        },
        { id: "click", kind: "click", description: "Click button.", selector: { strategy: "test-id", value: "btn" } },
        {
          id: "assert-result",
          kind: "assert",
          description: "Assert result visible.",
          assertionKind: "element-visible",
          selector: { strategy: "test-id", value: "result" },
          importance: "critical",
        },
        { id: "shot", kind: "screenshot", description: "Screenshot.", artifactName: "final", fullPage: false, animations: "disabled" },
      ];

      const adapter = new PlaywrightBrowserAdapter();
      const execution = await adapter.execute(plan(steps), context, {
        screenshotsDir: path.join(tempDir, "screenshots"),
        domDir: path.join(tempDir, "dom"),
      });

      expect(execution.launch.launched).toBe(true);
      expect(execution.stepResults.every((r) => r.status === "completed")).toBe(true);
      expect(execution.assertionObservations.find((a) => a.assertionId === "assert-title")?.actual).toBe(true);
      expect(execution.assertionObservations.find((a) => a.assertionId === "assert-result")?.actual).toBe(true);
      expect(execution.screenshots).toHaveLength(1);
      expect(execution.finalUrl).toBe(`${baseUrl}/`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("captures a sanitized DOM snapshot with scripts/event-handlers removed", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "dps-playwright-dom-"));
    try {
      const steps: BrowserCaptureStep[] = [
        { id: "nav", kind: "navigate", description: "Navigate.", path: "/", waitUntil: "load" },
        { id: "dom", kind: "dom-snapshot", description: "Snapshot.", artifactName: "page", sanitize: true },
      ];
      const adapter = new PlaywrightBrowserAdapter();
      const execution = await adapter.execute(plan(steps), context, {
        screenshotsDir: path.join(tempDir, "screenshots"),
        domDir: path.join(tempDir, "dom"),
      });

      expect(execution.domSnapshots).toHaveLength(1);
      const snapshot = execution.domSnapshots[0]!;
      const { readFile } = await import("node:fs/promises");
      const html = await readFile(snapshot.path, "utf8");
      expect(html).not.toContain("onclick");
      expect(snapshot.sanitization.sensitiveFieldsRedacted).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("blocks external navigation and records a safety violation", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "dps-playwright-blocked-"));
    try {
      const steps: BrowserCaptureStep[] = [
        { id: "nav", kind: "navigate", description: "Navigate to disallowed origin.", url: "https://example.com/", waitUntil: "load" },
      ];
      const adapter = new PlaywrightBrowserAdapter();
      const execution = await adapter.execute(plan(steps), context, {
        screenshotsDir: path.join(tempDir, "screenshots"),
        domDir: path.join(tempDir, "dom"),
      });

      expect(execution.stepResults[0]?.status).toBe("failed");
      expect(execution.safetyViolations.some((v) => v.kind === "external-navigation-blocked")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe.skipIf(chromiumAvailable)("PlaywrightBrowserAdapter — Chromium unavailable", () => {
  it("is skipped because Chromium is not installed in this environment", () => {
    expect(chromiumAvailable).toBe(false);
  });
});
