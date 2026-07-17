import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ArtifactEnvelope } from "../core/artifact.js";
import { DecisionLog } from "../core/decision-log.js";
import { EventLog } from "../core/event-log.js";
import { contentHashOf } from "../core/hash.js";
import { assertManifest, loadManifestFile, validateManifest, type DemoManifest } from "../core/manifest.js";
import { FilesystemArtifactRegistry } from "../registry/filesystem-artifact-registry.js";
import { UnderstandingEngine } from "../engines/understanding.js";
import type { ProductUnderstanding } from "../core/product-understanding.js";
import { PlanningEngine, type Plan } from "../engines/planning.js";
import { compileDIR } from "../engines/dir-compiler.js";
import type { DemoIntermediateRepresentation } from "../core/dir.js";

const PRODUCER = { name: "@dps/core", version: "0.1.0" } as const;

function envelope<T>(args: {
  readonly artifactId: string;
  readonly runId: string;
  readonly artifactType: string;
  readonly schemaVersion: string;
  readonly dependencyArtifactIds: readonly string[];
  readonly createdAt: string;
  readonly payload: T;
}): ArtifactEnvelope<T> {
  return {
    artifactId: args.artifactId,
    runId: args.runId,
    artifactType: args.artifactType,
    schemaVersion: args.schemaVersion,
    producer: PRODUCER,
    createdAt: args.createdAt,
    dependencyArtifactIds: args.dependencyArtifactIds,
    contentHash: contentHashOf(args.payload),
    payload: args.payload,
  };
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error("Usage: npm run demo -- <path-to-demo.yaml>");
    process.exitCode = 1;
    return;
  }

  const raw = await loadManifestFile(manifestPath);
  const preValidation = validateManifest(raw);
  if (!preValidation.ok) {
    console.error("demo.yaml failed schema validation:");
    for (const issue of preValidation.issues) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }
  const manifest: DemoManifest = assertManifest(raw);

  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(process.cwd(), ".dps", "runs", runId);
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
    source: "cli.demo",
    payload: { manifestPath },
  });

  let success = true;
  let failureReason: string | undefined;

  try {
    const manifestArtifact = envelope<DemoManifest>({
      artifactId: "manifest",
      runId,
      artifactType: "demo-manifest",
      schemaVersion: manifest.schemaVersion,
      dependencyArtifactIds: [],
      createdAt: now().toISOString(),
      payload: manifest,
    });
    await registry.put(manifestArtifact);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "manifest.validated",
      occurredAt: now().toISOString(),
      source: "cli.demo",
      payload: { artifactId: manifestArtifact.artifactId },
    });

    const understandingEngine = new UnderstandingEngine();
    const understandingValidation = understandingEngine.validate(manifest);
    if (!understandingValidation.ok) {
      throw new Error(
        `Understanding Engine rejected input: ${understandingValidation.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
    const understanding = await understandingEngine.run(manifest, context);
    decisionLog.recordAll(understandingEngine.decisionsFromLastRun());
    const understandingVerification = understandingEngine.verify(understanding);
    if (!understandingVerification.ok) {
      throw new Error("Understanding Engine output failed verification.");
    }

    const understandingArtifact = envelope<ProductUnderstanding>({
      artifactId: "understanding",
      runId,
      artifactType: "product-understanding",
      schemaVersion: understanding.schemaVersion,
      dependencyArtifactIds: [manifestArtifact.artifactId],
      createdAt: now().toISOString(),
      payload: understanding,
    });
    await registry.put(understandingArtifact);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "understanding.completed",
      occurredAt: now().toISOString(),
      source: understandingEngine.name,
      payload: { artifactId: understandingArtifact.artifactId },
    });

    const planningEngine = new PlanningEngine();
    const planningInput = { manifest, understanding };
    const planningValidation = planningEngine.validate(planningInput);
    if (!planningValidation.ok) {
      throw new Error(
        `Planning Engine rejected input: ${planningValidation.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
    const plan = await planningEngine.run(planningInput, context);
    decisionLog.recordAll(planningEngine.decisionsFromLastRun());
    const planningVerification = planningEngine.verify(plan);
    if (!planningVerification.ok) {
      throw new Error("Planning Engine output failed verification.");
    }

    const planArtifact = envelope<Plan>({
      artifactId: "plan",
      runId,
      artifactType: "plan",
      schemaVersion: plan.schemaVersion,
      dependencyArtifactIds: [understandingArtifact.artifactId],
      createdAt: now().toISOString(),
      payload: plan,
    });
    await registry.put(planArtifact);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "planning.completed",
      occurredAt: now().toISOString(),
      source: planningEngine.name,
      payload: { artifactId: planArtifact.artifactId },
    });

    const dir = compileDIR(manifest, understanding, plan);
    const dirArtifact = envelope<DemoIntermediateRepresentation>({
      artifactId: "dir",
      runId,
      artifactType: "demo-intermediate-representation",
      schemaVersion: dir.schemaVersion,
      dependencyArtifactIds: [planArtifact.artifactId],
      createdAt: now().toISOString(),
      payload: dir,
    });
    await registry.put(dirArtifact);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "dir.compiled",
      occurredAt: now().toISOString(),
      source: "dir-compiler",
      payload: { artifactId: dirArtifact.artifactId },
    });
  } catch (error) {
    success = false;
    failureReason = error instanceof Error ? error.message : String(error);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "run.failed",
      occurredAt: now().toISOString(),
      source: "cli.demo",
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
      source: "cli.demo",
      payload: {},
    });
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
    manifestPath: path.resolve(manifestPath),
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

  console.log(`Run ${runId} ${success ? "succeeded" : "failed"}.`);
  console.log(`Artifacts written to: ${runDir}`);
  if (!success) {
    console.error(`Reason: ${failureReason}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
