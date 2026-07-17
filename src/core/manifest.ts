import { readFile } from "node:fs/promises";
import { load as loadYaml } from "js-yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidationResult } from "./types.js";
import demoSchema from "../../schemas/demo.schema.json" with { type: "json" };

export type DemoManifest = {
  readonly schemaVersion: "0.1";
  readonly project: {
    readonly name: string;
    readonly repository?: string;
    readonly url?: string;
  };
  readonly product: {
    readonly problem: string;
    readonly audience: readonly string[];
    readonly valueProposition: string;
    readonly heroInteractionHint?: string;
    readonly evidenceHints?: readonly string[];
  };
  readonly demo: {
    readonly goal: "explain" | "convince" | "prove" | "onboard";
    readonly audience: string;
    readonly durationSeconds: number;
    readonly mode: "assisted" | "directed" | "autonomous";
    readonly styles?: readonly string[];
  };
  readonly constraints?: {
    readonly noGeneratedUI?: boolean;
    readonly minimumEvidenceCount?: number;
    readonly maximumOnScreenWords?: number;
  };
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(demoSchema);

export function validateManifest(raw: unknown): ValidationResult {
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

export async function loadManifestFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return loadYaml(raw);
}

export function assertManifest(raw: unknown): DemoManifest {
  const result = validateManifest(raw);
  if (!result.ok) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`demo.yaml failed schema validation: ${details}`);
  }
  return raw as DemoManifest;
}
