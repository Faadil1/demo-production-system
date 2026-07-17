import { describe, expect, it } from "vitest";
import { validateCapturePlan, type BrowserCapturePlan, type BrowserCaptureStep } from "../src/core/browser-capture-plan.js";
import { validateSelector, type BrowserSelector } from "../src/core/browser-selector.js";
import { DEFAULT_BROWSER_CAPTURE_POLICY } from "../src/core/browser-capture-policy.js";

function basePlan(steps: readonly BrowserCaptureStep[], overrides: Partial<BrowserCapturePlan> = {}): BrowserCapturePlan {
  return {
    schemaVersion: "0.1",
    id: "plan-1",
    target: { schemaVersion: "0.1", id: "t1", type: "local", baseUrl: "http://localhost:4173" },
    viewport: { width: 1280, height: 720 },
    policy: DEFAULT_BROWSER_CAPTURE_POLICY,
    steps,
    evidenceRequirements: [],
    ...overrides,
  };
}

const navigateStep: BrowserCaptureStep = { id: "nav", kind: "navigate", description: "go", path: "/", waitUntil: "load" };

describe("Selectors", () => {
  it("accepts a valid test-id selector", () => {
    expect(validateSelector({ strategy: "test-id", value: "product-title" }, "sel").ok).toBe(true);
  });

  it("accepts a valid role selector", () => {
    expect(validateSelector({ strategy: "role", role: "button", name: "Submit" }, "sel").ok).toBe(true);
  });

  it("rejects an empty selector value", () => {
    expect(validateSelector({ strategy: "test-id", value: "" }, "sel").ok).toBe(false);
    expect(validateSelector({ strategy: "css", value: "   " }, "sel").ok).toBe(false);
  });

  it("accepts css as a fallback", () => {
    expect(validateSelector({ strategy: "css", value: "#submit" }, "sel").ok).toBe(true);
  });

  it("rejects an unsupported selector strategy at runtime", () => {
    const bogus = { strategy: "xpath", value: "//button" } as unknown as BrowserSelector;
    expect(validateSelector(bogus, "sel").ok).toBe(false);
  });
});

describe("validateCapturePlan — steps", () => {
  it("requires at least one step", () => {
    expect(validateCapturePlan(basePlan([])).ok).toBe(false);
  });

  it("enforces policy.maximumSteps", () => {
    const steps = Array.from({ length: 3 }, (_, i) => ({ ...navigateStep, id: `nav-${i}` }));
    const plan = basePlan(steps, { policy: { ...DEFAULT_BROWSER_CAPTURE_POLICY, maximumSteps: 2 } });
    expect(validateCapturePlan(plan).ok).toBe(false);
  });

  it("rejects duplicate step ids", () => {
    const plan = basePlan([navigateStep, { ...navigateStep }]);
    const result = validateCapturePlan(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "duplicate-id")).toBe(true);
  });

  it("enforces viewport bounds", () => {
    expect(validateCapturePlan(basePlan([navigateStep], { viewport: { width: 100, height: 720 } })).ok).toBe(false);
    expect(validateCapturePlan(basePlan([navigateStep], { viewport: { width: 1280, height: 100 } })).ok).toBe(false);
    expect(validateCapturePlan(basePlan([navigateStep], { viewport: { width: 1280, height: 720, deviceScaleFactor: 10 } })).ok).toBe(false);
  });

  it("rejects right-click by default", () => {
    const step: BrowserCaptureStep = {
      id: "click",
      kind: "click",
      description: "click",
      selector: { strategy: "test-id", value: "x" },
      button: "right",
    };
    expect(validateCapturePlan(basePlan([navigateStep, step])).ok).toBe(false);
  });

  it("rejects multi-click by default", () => {
    const step: BrowserCaptureStep = {
      id: "click",
      kind: "click",
      description: "click",
      selector: { strategy: "test-id", value: "x" },
      clickCount: 2,
    };
    expect(validateCapturePlan(basePlan([navigateStep, step])).ok).toBe(false);
  });

  it("accepts default left single click", () => {
    const step: BrowserCaptureStep = { id: "click", kind: "click", description: "click", selector: { strategy: "test-id", value: "x" } };
    expect(validateCapturePlan(basePlan([navigateStep, step])).ok).toBe(true);
  });

  it("enforces the press key allowlist", () => {
    const bad: BrowserCaptureStep = { id: "p", kind: "press", description: "press", key: "F1" as never };
    expect(validateCapturePlan(basePlan([navigateStep, bad])).ok).toBe(false);

    const good: BrowserCaptureStep = { id: "p2", kind: "press", description: "press", key: "Enter" };
    expect(validateCapturePlan(basePlan([navigateStep, good])).ok).toBe(true);
  });

  it("requires dom-snapshot.sanitize to be true", () => {
    const step = { id: "d", kind: "dom-snapshot", description: "dom", artifactName: "snap", sanitize: false } as unknown as BrowserCaptureStep;
    expect(validateCapturePlan(basePlan([navigateStep, step])).ok).toBe(false);
  });

  it("rejects an invalid artifact name (path traversal)", () => {
    const step: BrowserCaptureStep = {
      id: "s",
      kind: "screenshot",
      description: "shot",
      artifactName: "../../etc/passwd",
      fullPage: false,
      animations: "disabled",
    };
    expect(validateCapturePlan(basePlan([navigateStep, step])).ok).toBe(false);
  });

  it("accepts a valid artifact name", () => {
    const step: BrowserCaptureStep = {
      id: "s",
      kind: "screenshot",
      description: "shot",
      artifactName: "before-state",
      fullPage: false,
      animations: "disabled",
    };
    expect(validateCapturePlan(basePlan([navigateStep, step])).ok).toBe(true);
  });

  it("blocks a navigate step whose absolute url targets a disallowed origin", () => {
    const step: BrowserCaptureStep = { id: "nav2", kind: "navigate", description: "external", url: "https://evil.example.com", waitUntil: "load" };
    const result = validateCapturePlan(basePlan([navigateStep, step]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.code === "origin-not-allowed")).toBe(true);
  });

  it("accepts a navigate step to an allowlisted external origin when allowExternalNavigation is true", () => {
    const step: BrowserCaptureStep = { id: "nav2", kind: "navigate", description: "external", url: "https://allowed.example.com/page", waitUntil: "load" };
    const plan = basePlan([navigateStep, step], {
      policy: { ...DEFAULT_BROWSER_CAPTURE_POLICY, allowExternalNavigation: true, allowedOrigins: ["https://allowed.example.com"] },
    });
    expect(validateCapturePlan(plan).ok).toBe(true);
  });
});
