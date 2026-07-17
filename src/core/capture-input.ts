import { readFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidationResult } from "./types.js";
import type { BrowserCapturePlan } from "./browser-capture-plan.js";
import browserCapturePlanSchema from "../../schemas/browser-capture-plan.schema.json" with { type: "json" };

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validateSchema = ajv.compile(browserCapturePlanSchema);

export function validateCapturePlanSchema(raw: unknown): ValidationResult {
  const ok = validateSchema(raw);
  if (ok) {
    return { ok: true };
  }
  return {
    ok: false,
    issues: (validateSchema.errors ?? []).map((error: import("ajv").ErrorObject) => ({
      path: error.instancePath || "/",
      code: error.keyword,
      message: error.message ?? "Schema validation failed.",
    })),
  };
}

export async function loadCapturePlanFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return loadYaml(raw);
}

export function assertCapturePlanSchema(raw: unknown): BrowserCapturePlan {
  const result = validateCapturePlanSchema(raw);
  if (!result.ok) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`capture.yaml failed schema validation: ${details}`);
  }
  return raw as BrowserCapturePlan;
}
