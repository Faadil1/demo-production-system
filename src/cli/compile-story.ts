import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { load as loadYaml } from "js-yaml";
import { DecisionLog } from "../core/decision-log.js";
import { EventLog } from "../core/event-log.js";
import { FilesystemArtifactRegistry } from "../registry/filesystem-artifact-registry.js";
import { StoryEngine } from "../engines/story.js";
import type { StoryCompilerInput, Storyboard } from "../core/story.js";
import { buildArtifactEnvelope as envelope } from "./artifact-envelope.js";
import { determineExitCode } from "./exit-code-policy.js";

/**
 * `compile-story` reads a `StoryCompilerInput` from a file. §32 of RFC-0005 specifies
 * `npm run compile-story -- <path-to-story-input.yaml>`, matching the YAML-input
 * convention `analyze-demo`/`capture-browser` already use. The Story Engine's input is a
 * composition of upstream artifacts (ProductUnderstanding, DIR, ExistingDemoAnalysis,
 * BrowserCaptureResult[]) that are themselves already produced by other CLI commands, so
 * in practice that YAML (or JSON) document assembles those artifact payloads directly
 * rather than describing raw source data — but the file format itself now matches every
 * other RFC-0002-0004 CLI: `.yaml`/`.yml` is parsed as YAML, anything else (including
 * `.json`) is parsed as JSON. Artifact-id-based input resolution (reading upstream
 * artifacts from the filesystem registry by id instead of inlining their payloads) is
 * left as CLI follow-up work (documented in the implementation doc's Known Limitations).
 */
async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run compile-story -- <path-to-story-input.yaml>");
    process.exitCode = 1;
    return;
  }

  let input: StoryCompilerInput;
  try {
    const raw = await readFile(inputPath, "utf8");
    const isYaml = /\.ya?ml$/i.test(inputPath);
    input = (isYaml ? loadYaml(raw) : JSON.parse(raw)) as StoryCompilerInput;
  } catch (error) {
    console.error(`Failed to read/parse story input: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

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
    source: "cli.compile-story",
    payload: { inputPath },
  });

  let success = true;
  let failureReason: string | undefined;
  let storyboard: Storyboard | undefined;

  try {
    const engine = new StoryEngine();
    const validation = engine.validate(input);
    if (!validation.ok) {
      throw new Error(`StoryEngine rejected input: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    }

    storyboard = await engine.run(input, context);
    decisionLog.recordAll(engine.decisionsFromLastRun());
    // engine.verify() intentionally is NOT used to abort the pipeline — a failed Story
    // Gate is a legitimate, honest compilation outcome that must still be persisted (see
    // docs/005, docs/007) — only the CLI's exit code reflects it.
    engine.verify(storyboard);

    const storyboardArtifact = envelope<Storyboard>({
      artifactId: "storyboard",
      runId,
      artifactType: "storyboard",
      schemaVersion: storyboard.schemaVersion,
      dependencyArtifactIds: storyboard.sourceArtifactIds,
      createdAt: now().toISOString(),
      payload: storyboard,
    });
    await registry.put(storyboardArtifact);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "storyboard.compiled",
      occurredAt: now().toISOString(),
      source: engine.name,
      payload: { artifactId: storyboardArtifact.artifactId, gateStatus: storyboard.gate.status },
    });
  } catch (error) {
    success = false;
    failureReason = error instanceof Error ? error.message : String(error);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "run.failed",
      occurredAt: now().toISOString(),
      source: "cli.compile-story",
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
      source: "cli.compile-story",
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
    inputPath: path.resolve(inputPath),
    gateStatus: storyboard?.gate.status ?? null,
    storyMode: storyboard?.storyMode ?? null,
    sceneCount: storyboard?.scenes.length ?? null,
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
  if (storyboard) {
    console.log(`Story Gate status: ${storyboard.gate.status}`);
    console.log(`Story mode: ${storyboard.storyMode}`);
    console.log(`Scenes: ${storyboard.scenes.length}`);
  }

  const exitCode = determineExitCode(success, storyboard?.gate.status ?? null);
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
