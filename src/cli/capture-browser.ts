import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DecisionLog } from "../core/decision-log.js";
import { EventLog } from "../core/event-log.js";
import { assertCapturePlanSchema, loadCapturePlanFile, validateCapturePlanSchema } from "../core/capture-input.js";
import { validateCapturePlan, type BrowserCapturePlan } from "../core/browser-capture-plan.js";
import { FilesystemArtifactRegistry } from "../registry/filesystem-artifact-registry.js";
import { BrowserCaptureEngine } from "../engines/browser-capture.js";
import { PlaywrightBrowserAdapter } from "../adapters/playwright-browser-adapter.js";
import type { BrowserCaptureResult } from "../core/browser-capture-result.js";
import { bridgeBrowserCaptureToUnderstanding } from "../bridges/browser-capture-to-understanding.js";
import { buildArtifactEnvelope as envelope } from "./artifact-envelope.js";
import { determineExitCode } from "./exit-code-policy.js";

async function main(): Promise<void> {
  const yamlPath = process.argv[2];
  if (!yamlPath) {
    console.error("Usage: npm run capture-browser -- <path-to-capture.yaml>");
    process.exitCode = 1;
    return;
  }

  const raw = await loadCapturePlanFile(yamlPath);
  const preValidation = validateCapturePlanSchema(raw);
  if (!preValidation.ok) {
    console.error("capture.yaml failed schema validation:");
    for (const issue of preValidation.issues) console.error(`  ${issue.path}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  const plan: BrowserCapturePlan = assertCapturePlanSchema(raw);

  const semanticValidation = validateCapturePlan(plan);
  if (!semanticValidation.ok) {
    console.error("capture.yaml failed plan validation:");
    for (const issue of semanticValidation.issues) console.error(`  ${issue.path}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(process.cwd(), ".dps", "runs", runId);
  const screenshotsDir = path.join(runDir, "screenshots");
  const domDir = path.join(runDir, "dom");
  await mkdir(runDir, { recursive: true });

  const registry = new FilesystemArtifactRegistry(runDir);
  const decisionLog = new DecisionLog();
  const eventLog = new EventLog();
  const now = () => new Date();
  const context = { runId, now };

  const startedAt = now().toISOString();
  await eventLog.publish({
    eventId: randomUUID(),
    runId,
    type: "run.started",
    occurredAt: startedAt,
    source: "cli.capture-browser",
    payload: { yamlPath },
  });

  let success = true;
  let failureReason: string | undefined;
  let result: BrowserCaptureResult | undefined;

  try {
    const planArtifact = envelope<BrowserCapturePlan>({
      artifactId: "capture-plan",
      runId,
      artifactType: "browser-capture-plan",
      schemaVersion: plan.schemaVersion,
      dependencyArtifactIds: [],
      createdAt: now().toISOString(),
      payload: plan,
    });
    await registry.put(planArtifact);

    const engine = new BrowserCaptureEngine(new PlaywrightBrowserAdapter());
    const engineInput = { plan, screenshotsDir, domDir };
    const engineValidation = engine.validate(engineInput);
    if (!engineValidation.ok) {
      throw new Error(
        `BrowserCaptureEngine rejected input: ${engineValidation.issues.map((issue) => issue.message).join("; ")}`,
      );
    }

    result = await engine.run(engineInput, context);
    decisionLog.recordAll(engine.decisionsFromLastRun());
    // A failed gate is a legitimate, honest outcome that must still be persisted — the
    // CLI's exit code (not an aborted pipeline) is what communicates it, mirroring
    // analyze-demo's treatment of a failed Analysis Gate.
    engine.verify(result);

    await registry.put(
      envelope({
        artifactId: "browser-execution",
        runId,
        artifactType: "browser-execution",
        schemaVersion: "0.1",
        dependencyArtifactIds: ["capture-plan"],
        createdAt: now().toISOString(),
        payload: { launch: result.launch, finalUrl: result.finalUrl, durationMs: result.durationMs },
      }),
    );
    await registry.put(
      envelope({
        artifactId: "browser-step-results",
        runId,
        artifactType: "browser-step-results",
        schemaVersion: "0.1",
        dependencyArtifactIds: ["capture-plan"],
        createdAt: now().toISOString(),
        payload: result.stepResults,
      }),
    );
    await registry.put(
      envelope({
        artifactId: "browser-assertions",
        runId,
        artifactType: "browser-assertions",
        schemaVersion: "0.1",
        dependencyArtifactIds: ["capture-plan"],
        createdAt: now().toISOString(),
        payload: result.assertions,
      }),
    );
    await registry.put(
      envelope({
        artifactId: "browser-network",
        runId,
        artifactType: "browser-network",
        schemaVersion: "0.1",
        dependencyArtifactIds: ["capture-plan"],
        createdAt: now().toISOString(),
        payload: result.networkRecords,
      }),
    );
    await registry.put(
      envelope({
        artifactId: "browser-observations",
        runId,
        artifactType: "demo-observation-timeline",
        schemaVersion: result.observationTimeline.schemaVersion,
        dependencyArtifactIds: ["capture-plan"],
        createdAt: now().toISOString(),
        payload: result.observationTimeline,
      }),
    );
    await registry.put(
      envelope({
        artifactId: "browser-evidence-manifest",
        runId,
        artifactType: "browser-evidence-manifest",
        schemaVersion: result.evidenceManifest.schemaVersion,
        dependencyArtifactIds: ["capture-plan", "browser-observations"],
        createdAt: now().toISOString(),
        payload: result.evidenceManifest,
      }),
    );
    await registry.put(
      envelope({
        artifactId: "browser-capture-result",
        runId,
        artifactType: "browser-capture-result",
        schemaVersion: result.schemaVersion,
        dependencyArtifactIds: ["browser-evidence-manifest"],
        createdAt: now().toISOString(),
        payload: result,
      }),
    );

    const bridged = bridgeBrowserCaptureToUnderstanding(plan, result, runId);
    await registry.put(
      envelope({
        artifactId: "understanding-evidence",
        runId,
        artifactType: "browser-capture-understanding-evidence",
        schemaVersion: bridged.schemaVersion,
        dependencyArtifactIds: ["browser-capture-result"],
        createdAt: now().toISOString(),
        payload: bridged,
      }),
    );

    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "capture.completed",
      occurredAt: now().toISOString(),
      source: engine.name,
      payload: { gateStatus: result.gate.status },
    });
  } catch (error) {
    success = false;
    failureReason = error instanceof Error ? error.message : String(error);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "run.failed",
      occurredAt: now().toISOString(),
      source: "cli.capture-browser",
      payload: { reason: failureReason },
    });
  }

  const completedAt = now().toISOString();
  if (success) {
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "run.completed",
      occurredAt: completedAt,
      source: "cli.capture-browser",
      payload: {},
    });
  }

  await decisionLog.writeTo(path.join(runDir, "decisions.json"));
  await eventLog.writeTo(path.join(runDir, "events.json"));

  const artifacts = await registry.list(runId);
  const stepsCompleted = result?.stepResults.filter((step) => step.status === "completed").length ?? 0;
  const stepsFailed = result?.stepResults.filter((step) => step.status === "failed" || step.status === "timeout").length ?? 0;
  const assertionsPassed = result?.assertions.filter((assertion) => assertion.status === "passed").length ?? 0;
  const assertionsFailed = result?.assertions.filter((assertion) => assertion.status !== "passed").length ?? 0;

  const runSummary = {
    schemaVersion: "0.1",
    runId,
    success,
    failureReason,
    startedAt,
    completedAt,
    yamlPath: path.resolve(yamlPath),
    gateStatus: result?.gate.status ?? null,
    stepsCompleted,
    stepsFailed,
    assertionsPassed,
    assertionsFailed,
    evidenceCoverageRatio: result?.evidenceManifest.coverage.coverageRatio ?? null,
    artifacts: artifacts
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        artifactType: artifact.artifactType,
        contentHash: artifact.contentHash,
        producer: artifact.producer,
      }))
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    decisionCount: decisionLog.all().length,
    eventCount: eventLog.all().length,
  };
  await writeFile(path.join(runDir, "run-summary.json"), JSON.stringify(runSummary, null, 2), "utf8");

  console.log(`Run ${runId} ${success ? "completed" : "failed"}.`);
  console.log(`Artifacts written to: ${runDir}`);
  if (result) {
    console.log(`Gate status: ${result.gate.status}`);
    console.log(`Steps: ${stepsCompleted} completed, ${stepsFailed} failed.`);
    console.log(`Assertions: ${assertionsPassed} passed, ${assertionsFailed} failed.`);
    console.log(`Evidence coverage ratio: ${result.evidenceManifest.coverage.coverageRatio}`);
  }

  const exitCode = determineExitCode(success, result?.gate.status ?? null);
  if (exitCode !== 0 && !success) {
    console.error(`Reason: ${failureReason}`);
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
