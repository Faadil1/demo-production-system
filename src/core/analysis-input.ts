import { readFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidationResult } from "./types.js";
import type { MediaSource } from "./media-source.js";
import type { Transcript } from "./transcript.js";
import type { DemoObservationTimeline } from "./demo-observation.js";
import analysisInputSchema from "../../schemas/existing-demo-analysis-input.schema.json" with { type: "json" };

export type AnalysisInputFile = {
  readonly schemaVersion: "0.1";
  readonly source: MediaSource;
  readonly goal?: "explain" | "convince" | "prove" | "onboard";
  readonly transcript?: Transcript;
  readonly observationTimeline?: DemoObservationTimeline;
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(analysisInputSchema);

export function validateAnalysisInputFile(raw: unknown): ValidationResult {
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

export async function loadAnalysisInputFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return loadYaml(raw);
}

export function assertAnalysisInputFile(raw: unknown): AnalysisInputFile {
  const result = validateAnalysisInputFile(raw);
  if (!result.ok) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`analysis.yaml failed schema validation: ${details}`);
  }
  return raw as AnalysisInputFile;
}
