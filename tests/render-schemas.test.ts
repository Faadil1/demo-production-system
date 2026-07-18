import path from "node:path";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { RenderEngine } from "../src/engines/render.js";
import { DPS_LANDSCAPE_1080P30_V01 } from "../src/core/render.js";
import { buildBundle, defaultAdapterCapabilities, twoSceneStoryboard } from "./fixtures/render-fixtures.js";

const schemasDir = path.join(__dirname, "..", "schemas");
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(schemasDir, name), "utf8")) as Record<string, unknown>;
}

function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(loadSchema("render-output-profile.schema.json"), "render-output-profile.schema.json");
  ajv.addSchema(loadSchema("render-finding.schema.json"), "render-finding.schema.json");
  return ajv;
}

const context = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };

describe("RFC-0006 runtime JSON schemas — Appendix B inventory", () => {
  it("validates the Appendix D reference output profile", () => {
    const ajv = makeAjv();
    const validate = ajv.getSchema("render-output-profile.schema.json")!;
    expect(validate(DPS_LANDSCAPE_1080P30_V01)).toBe(true);
  });

  it("rejects an output profile with a negative safe-area inset", () => {
    const ajv = makeAjv();
    const validate = ajv.getSchema("render-output-profile.schema.json")!;
    const invalid = { ...DPS_LANDSCAPE_1080P30_V01, safeAreaInsetsPx: { top: -1, right: 0, bottom: 0, left: 0 } };
    expect(validate(invalid)).toBe(false);
  });

  it("validates RenderCompilerInput", () => {
    const ajv = makeAjv();
    ajv.addSchema(loadSchema("render-compiler-input.schema.json"), "render-compiler-input.schema.json");
    const validate = ajv.getSchema("render-compiler-input.schema.json")!;
    const bundle = buildBundle({ storyboard: twoSceneStoryboard() });
    expect(validate(bundle.input)).toBe(true);
  });

  it("rejects RenderCompilerInput with an empty required scalar", () => {
    const ajv = makeAjv();
    ajv.addSchema(loadSchema("render-compiler-input.schema.json"), "render-compiler-input.schema.json");
    const validate = ajv.getSchema("render-compiler-input.schema.json")!;
    const bundle = buildBundle({ storyboard: twoSceneStoryboard() });
    expect(validate({ ...bundle.input, storyboardArtifactId: "" })).toBe(false);
  });

  it("validates AdapterCapabilities", () => {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema("adapter-capabilities.schema.json"));
    expect(validate(defaultAdapterCapabilities())).toBe(true);
  });

  it("validates a compiled RenderPlan, ResolvedRenderAsset[], and RenderGateResult", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({ storyboard });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;

    const ajv = makeAjv();
    const planValidate = ajv.compile(loadSchema("render-plan.schema.json"));
    expect(planValidate(result.plan)).toBe(true);

    const assetsValidate = ajv.compile(loadSchema("resolved-render-assets.schema.json"));
    expect(assetsValidate(result.resolvedAssets)).toBe(true);

    const gateValidate = ajv.compile(loadSchema("render-gate.schema.json"));
    expect(gateValidate(result.gate)).toBe(true);
  });

  it("validates a RenderRejection (Case A)", async () => {
    const storyboard = { ...twoSceneStoryboard(), gate: { status: "fail" as const, blockingReasons: ["x"], warnings: [], requirementsBeforeRender: [] } };
    const bundle = buildBundle({ storyboard });
    const result = await new RenderEngine().run(bundle, context);
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema("render-rejection.schema.json"));
    expect(validate(result.rejection)).toBe(true);
  });

  it("validates a RenderOverrideRecord and rejects a disallowed reasonCode", () => {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema("render-override.schema.json"));
    const valid = {
      schemaVersion: "0.1",
      id: "override-1",
      findingId: "finding-1",
      reasonCode: "OPTIONAL_ASSET_UNAVAILABLE",
      authority: { kind: "human", authorityId: "reviewer-1" },
      rationale: "Acceptable.",
      policy: { id: "override-policy", version: "0.1" },
      createdAt: "2026-07-17T00:00:00Z",
      reversible: true,
    };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, reasonCode: "ASSET_MISSING" })).toBe(false);
  });

  it("validates PostRenderValidationRequest (defined, never executed by this pipeline)", () => {
    const ajv = makeAjv();
    const validate = ajv.compile(loadSchema("post-render-validation-request.schema.json"));
    expect(
      validate({
        schemaVersion: "0.1",
        renderPlanArtifactId: "render-plan",
        renderedOutputArtifactId: "rendered-output",
        expectedTotalFrames: 120,
        expectedOutputProfile: DPS_LANDSCAPE_1080P30_V01,
      }),
    ).toBe(true);
  });
});
