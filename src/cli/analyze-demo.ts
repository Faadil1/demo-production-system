import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DecisionLog } from "../core/decision-log.js";
import { EventLog } from "../core/event-log.js";
import {
  assertAnalysisInputFile,
  loadAnalysisInputFile,
  validateAnalysisInputFile,
  type AnalysisInputFile,
} from "../core/analysis-input.js";
import { validateTranscript, type Transcript } from "../core/transcript.js";
import { validateObservationTimeline, type DemoObservationTimeline } from "../core/demo-observation.js";
import type { MediaSource } from "../core/media-source.js";
import type { MediaInspection } from "../core/media-inspection.js";
import { FfprobeMediaInspector } from "../adapters/ffprobe-media-inspector.js";
import { FilesystemArtifactRegistry } from "../registry/filesystem-artifact-registry.js";
import { ExistingDemoAnalysisEngine } from "../engines/existing-demo-analysis.js";
import type { ExistingDemoAnalysis } from "../core/existing-demo-analysis.js";
import { buildArtifactEnvelope as envelope } from "./artifact-envelope.js";
import { determineExitCode } from "./exit-code-policy.js";

async function main(): Promise<void> {
  const yamlPath = process.argv[2];
  if (!yamlPath) {
    console.error("Usage: npm run analyze-demo -- <path-to-analysis.yaml>");
    process.exitCode = 1;
    return;
  }

  const raw = await loadAnalysisInputFile(yamlPath);
  const preValidation = validateAnalysisInputFile(raw);
  if (!preValidation.ok) {
    console.error("analysis.yaml failed schema validation:");
    for (const issue of preValidation.issues) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }
  const inputFile: AnalysisInputFile = assertAnalysisInputFile(raw);

  // Structural transcript/observation validation that does not depend on media
  // duration happens before any run directory is created, mirroring the `demo` CLI's
  // "invalid configuration fails before engine execution" behavior.
  if (inputFile.transcript) {
    const result = validateTranscript(inputFile.transcript, null);
    if (!result.ok) {
      console.error("transcript failed validation:");
      for (const issue of result.issues) console.error(`  ${issue.path}: ${issue.message}`);
      process.exitCode = 1;
      return;
    }
  }
  if (inputFile.observationTimeline) {
    const result = validateObservationTimeline(inputFile.observationTimeline);
    if (!result.ok) {
      console.error("observationTimeline failed validation:");
      for (const issue of result.issues) console.error(`  ${issue.path}: ${issue.message}`);
      process.exitCode = 1;
      return;
    }
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
    source: "cli.analyze-demo",
    payload: { yamlPath },
  });

  let success = true;
  let failureReason: string | undefined;
  let analysis: ExistingDemoAnalysis | undefined;

  try {
    const source: MediaSource = inputFile.source;
    const sourceArtifact = envelope<MediaSource>({
      artifactId: "source",
      runId,
      artifactType: "media-source",
      schemaVersion: source.schemaVersion,
      dependencyArtifactIds: [],
      createdAt: now().toISOString(),
      payload: source,
    });
    await registry.put(sourceArtifact);

    const inspector = new FfprobeMediaInspector({ baseDir: path.dirname(path.resolve(yamlPath)) });
    const mediaInspection: MediaInspection = await inspector.inspect(source, context);
    const mediaInspectionArtifact = envelope<MediaInspection>({
      artifactId: "media-inspection",
      runId,
      artifactType: "media-inspection",
      schemaVersion: mediaInspection.schemaVersion,
      dependencyArtifactIds: [sourceArtifact.artifactId],
      createdAt: now().toISOString(),
      payload: mediaInspection,
    });
    await registry.put(mediaInspectionArtifact);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "media.inspected",
      occurredAt: now().toISOString(),
      source: inspector.name,
      payload: { artifactId: mediaInspectionArtifact.artifactId, status: mediaInspection.status },
    });

    const dependencyIds = [mediaInspectionArtifact.artifactId];

    if (inputFile.transcript) {
      const transcript: Transcript = inputFile.transcript;
      const transcriptArtifact = envelope<Transcript>({
        artifactId: "transcript",
        runId,
        artifactType: "transcript",
        schemaVersion: transcript.schemaVersion,
        dependencyArtifactIds: [sourceArtifact.artifactId],
        createdAt: now().toISOString(),
        payload: transcript,
      });
      await registry.put(transcriptArtifact);
      dependencyIds.push(transcriptArtifact.artifactId);
    }

    if (inputFile.observationTimeline) {
      const observationTimeline: DemoObservationTimeline = inputFile.observationTimeline;
      const observationsArtifact = envelope<DemoObservationTimeline>({
        artifactId: "observations",
        runId,
        artifactType: "demo-observation-timeline",
        schemaVersion: observationTimeline.schemaVersion,
        dependencyArtifactIds: [sourceArtifact.artifactId],
        createdAt: now().toISOString(),
        payload: observationTimeline,
      });
      await registry.put(observationsArtifact);
      dependencyIds.push(observationsArtifact.artifactId);
    }

    const engine = new ExistingDemoAnalysisEngine();
    const engineInput = {
      source,
      mediaInspection,
      ...(inputFile.transcript ? { transcript: inputFile.transcript } : {}),
      ...(inputFile.observationTimeline ? { observationTimeline: inputFile.observationTimeline } : {}),
      ...(inputFile.goal ? { goal: inputFile.goal } : {}),
    };
    const engineValidation = engine.validate(engineInput);
    if (!engineValidation.ok) {
      throw new Error(
        `ExistingDemoAnalysisEngine rejected input: ${engineValidation.issues.map((issue) => issue.message).join("; ")}`,
      );
    }

    analysis = await engine.run(engineInput, context);
    decisionLog.recordAll(engine.decisionsFromLastRun());
    // engine.verify() intentionally is NOT used to abort the pipeline: a failed gate is
    // a legitimate, honest analysis outcome that must still be persisted (see docs/005)
    // — only the CLI's exit code reflects it, never a thrown/aborted run.
    engine.verify(analysis);

    const analysisArtifact = envelope<ExistingDemoAnalysis>({
      artifactId: "existing-demo-analysis",
      runId,
      artifactType: "existing-demo-analysis",
      schemaVersion: analysis.schemaVersion,
      dependencyArtifactIds: dependencyIds,
      createdAt: now().toISOString(),
      payload: analysis,
    });
    await registry.put(analysisArtifact);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "analysis.completed",
      occurredAt: now().toISOString(),
      source: engine.name,
      payload: { artifactId: analysisArtifact.artifactId, gateStatus: analysis.gate.status },
    });
  } catch (error) {
    success = false;
    failureReason = error instanceof Error ? error.message : String(error);
    await eventLog.publish({
      eventId: randomUUID(),
      runId,
      type: "run.failed",
      occurredAt: now().toISOString(),
      source: "cli.analyze-demo",
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
      source: "cli.analyze-demo",
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
    yamlPath: path.resolve(yamlPath),
    gateStatus: analysis?.gate.status ?? null,
    scoreTotal: analysis?.score.total ?? null,
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
  if (analysis) {
    console.log(`Gate status: ${analysis.gate.status}`);
    console.log(`Score: ${analysis.score.total}/${analysis.score.maximum} (${analysis.score.grade})`);
  }

  const exitCode = determineExitCode(success, analysis?.gate.status ?? null);
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
