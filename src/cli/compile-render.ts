import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { load as loadYaml } from "js-yaml";
import { DecisionLog } from "../core/decision-log.js";
import { EventLog } from "../core/event-log.js";
import { FilesystemArtifactRegistry } from "../registry/filesystem-artifact-registry.js";
import { RenderEngine, type RenderCompilationResult } from "../engines/render.js";
import type { RenderCompilerBundle } from "../core/render-input.js";
import { canonicalHash } from "../core/render-canonical.js";
import { buildArtifactEnvelope as envelope } from "./artifact-envelope.js";
import { determineExitCode } from "./exit-code-policy.js";

/**
 * §42 `compile-render`: `npm run compile-render -- <path-to-render-input>`.
 *
 * The input file is a `RenderCompilerBundle` (see src/core/render-input.ts) — a
 * `RenderCompilerInput` (§10) plus the upstream artifact payloads it references
 * (Storyboard, AdapterCapabilities, asset candidate bytes, binding/text-layer requests,
 * overrides), following the same "embed the referenced payloads inline" convention
 * `compile-story` documents for `StoryCompilerInput`. `storyboardContentHash` and
 * `adapterCapabilitiesHash` are always recomputed by this CLI from the supplied payloads
 * (never trusted from the file) so a tampered or stale hash cannot silently pass entry
 * validation.
 *
 * This CLI never triggers adapter compilation, rendering, export, or post-render
 * validation — it only compiles a Render Plan and evaluates the technical Render Gate.
 */
async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run compile-render -- <path-to-render-input>");
    process.exitCode = 1;
    return;
  }

  type RawBundle = Omit<RenderCompilerBundle, "storyboardContentHash" | "adapterCapabilitiesHash">;
  let raw: RawBundle;
  try {
    const text = await readFile(inputPath, "utf8");
    const isYaml = /\.ya?ml$/i.test(inputPath);
    raw = (isYaml ? loadYaml(text) : JSON.parse(text)) as RawBundle;
  } catch (error) {
    console.error(`Failed to read/parse render input: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const bundle: RenderCompilerBundle = {
    ...raw,
    storyboardContentHash: canonicalHash(raw.storyboard),
    adapterCapabilitiesHash: canonicalHash(raw.adapterCapabilities),
  };

  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(process.cwd(), ".dps", "runs", runId);
  await mkdir(runDir, { recursive: true });

  const registry = new FilesystemArtifactRegistry(runDir);
  const decisionLog = new DecisionLog();
  const eventLog = new EventLog();
  const now = () => new Date();
  const context = { runId, now };

  const startedAt = now().toISOString();
  await eventLog.publish({ eventId: randomUUID(), runId, type: "run.started", occurredAt: startedAt, source: "cli.compile-render", payload: { inputPath } });

  let success = true;
  let failureReason: string | undefined;
  let result: RenderCompilationResult | undefined;
  let gateStatus: "pass" | "conditional" | "fail" | null = null;
  let planArtifactId: string | null = null;

  try {
    const engine = new RenderEngine();
    const validation = engine.validate(bundle);
    if (!validation.ok) {
      throw new Error(`RenderEngine rejected input: ${validation.issues.map((i) => i.message).join("; ")}`);
    }

    result = await engine.run(bundle, context);

    if (result.kind === "rejected") {
      // Case A: no canonical Render Plan can be produced — emit RenderRejection only.
      gateStatus = null;
      const rejectionArtifact = envelope({
        artifactId: "render-rejection",
        runId,
        artifactType: "render-rejection",
        schemaVersion: result.rejection.schemaVersion,
        dependencyArtifactIds: result.rejection.inputArtifactIds,
        createdAt: now().toISOString(),
        payload: result.rejection,
      });
      await registry.put(rejectionArtifact);
    } else {
      // Cases B/C: resolved-assets + plan are always persisted once a canonical plan
      // exists, regardless of gate status (§40).
      const resolvedAssetsArtifact = envelope({
        artifactId: "resolved-assets",
        runId,
        artifactType: "resolved-render-assets",
        schemaVersion: "0.1",
        dependencyArtifactIds: [bundle.input.storyboardArtifactId],
        createdAt: now().toISOString(),
        payload: result.resolvedAssets,
      });
      await registry.put(resolvedAssetsArtifact);

      const planArtifact = envelope({
        artifactId: "render-plan",
        runId,
        artifactType: "render-plan",
        schemaVersion: result.plan.schemaVersion,
        dependencyArtifactIds: [bundle.input.storyboardArtifactId, bundle.input.adapterCapabilitiesArtifactId],
        createdAt: now().toISOString(),
        payload: result.plan,
      });
      await registry.put(planArtifact);
      planArtifactId = planArtifact.artifactId;

      const gateArtifact = envelope({
        artifactId: "render-gate",
        runId,
        artifactType: "render-gate-result",
        schemaVersion: result.gate.schemaVersion,
        dependencyArtifactIds: [planArtifact.artifactId],
        createdAt: now().toISOString(),
        payload: result.gate,
      });
      await registry.put(gateArtifact);
      gateStatus = result.gate.status;
    }

    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "render.compiled",
      occurredAt: now().toISOString(),
      source: engine.name,
      payload: { kind: result.kind, gateStatus },
    });
  } catch (error) {
    success = false;
    failureReason = error instanceof Error ? error.message : String(error);
    await eventLog.publish({ eventId: randomUUID(), runId, type: "run.failed", occurredAt: now().toISOString(), source: "cli.compile-render", payload: { reason: failureReason } });
  }

  const completedAt = now().toISOString();
  if (success) {
    await eventLog.publish({ eventId: randomUUID(), runId, type: "run.completed", occurredAt: completedAt, source: "cli.compile-render", payload: {} });
  }

  await decisionLog.writeTo(path.join(runDir, "decisions.json"));
  await eventLog.writeTo(path.join(runDir, "events.json"));

  const artifacts = await registry.list(runId);
  const runSummary = {
    schemaVersion: "0.1",
    runId,
    success,
    failureReason,
    startedAt,
    completedAt,
    inputPath: path.resolve(inputPath),
    resultKind: result?.kind ?? null,
    gateStatus,
    planArtifactId,
    blockingFindingCount: result?.kind === "compiled" ? result.gate.blockingFindings.length : result?.kind === "rejected" ? result.rejection.findings.length : null,
    warningCount: result?.kind === "compiled" ? result.gate.warnings.length : null,
    artifacts: artifacts
      .map((a) => ({ artifactId: a.artifactId, artifactType: a.artifactType, contentHash: a.contentHash }))
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
  };
  await writeFile(path.join(runDir, "run-summary.json"), JSON.stringify(runSummary, null, 2), "utf8");

  console.log(`Run ${runId} ${success ? "completed" : "failed"}.`);
  console.log(`Artifacts written to: ${runDir}`);
  console.log(`Result: ${result?.kind ?? "n/a"}`);
  console.log(`Render Gate status: ${gateStatus ?? "n/a"}`);
  if (planArtifactId) console.log(`Render Plan artifact: ${planArtifactId}`);
  console.log(`Findings: ${runSummary.blockingFindingCount ?? 0} blocking, ${runSummary.warningCount ?? 0} warnings`);

  // §42 exit codes: 0 only for a canonical plan with pass/conditional. Rejection (Case A),
  // gate fail (Case B), invalid input, or a pipeline exception all exit 1 — reusing
  // `determineExitCode`'s pass/conditional/fail semantics, plus treating "no plan at all"
  // (rejected) as an implicit fail for exit-code purposes only (the artifact contents
  // still distinguish rejection from a failed gate).
  const effectiveGateStatus = result?.kind === "rejected" ? "fail" : gateStatus;
  const exitCode = determineExitCode(success, effectiveGateStatus);
  if (exitCode !== 0) {
    if (!success) console.error(`Reason: ${failureReason}`);
    process.exitCode = exitCode;
  } else {
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
