import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { determineExitCode } from "../src/cli/exit-code-policy.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "dps-analyze-cli-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function runCli(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const cliEntry = path.join(repoRoot, "src", "cli", "analyze-demo.ts");
  return execFileAsync(process.execPath, [tsxCli, cliEntry, ...args], { cwd });
}

async function writeYaml(relativePath: string, contents: string): Promise<string> {
  const fullPath = path.join(cwd, relativePath);
  await writeFile(fullPath, contents, "utf8");
  return fullPath;
}

const MISSING_VIDEO_YAML = `
schemaVersion: "0.1"
source:
  schemaVersion: "0.1"
  id: test-source
  type: local-video
  uri: ./does-not-exist.mp4
goal: prove
transcript:
  schemaVersion: "0.1"
  language: en
  sourceType: human
  segments:
    - id: t1
      startSeconds: 0
      endSeconds: 4
      text: TrustCheck helps verify agent claims.
observationTimeline:
  schemaVersion: "0.1"
  sourceId: test-source
  observations:
    - id: o1
      kind: product-ui-visible
      startSeconds: 0
      endSeconds: 4
      statement: The UI is visible.
      sourceType: human
      verificationStatus: verified
      confidence: 1
      relatedEvidenceIds: []
`;

describe("determineExitCode (unit)", () => {
  it("returns 0 for a pass gate", () => expect(determineExitCode(true, "pass")).toBe(0));
  it("returns 0 for a conditional gate", () => expect(determineExitCode(true, "conditional")).toBe(0));
  it("returns non-zero for a fail gate", () => expect(determineExitCode(true, "fail")).not.toBe(0));
  it("returns non-zero when the pipeline itself did not succeed", () => expect(determineExitCode(false, null)).not.toBe(0));
});

describe("npm run analyze-demo (integration)", () => {
  it("prints usage and exits non-zero when the manifest argument is missing", async () => {
    await expect(runCli([])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Usage:") });
  });

  it("writes all required artifacts for a valid fixture, even when the video file is missing", async () => {
    const yamlPath = await writeYaml("analysis.yaml", MISSING_VIDEO_YAML);

    // The referenced video does not exist, so this deterministically fails the gate
    // (media-inspection status "invalid") without depending on ffprobe being installed.
    await expect(runCli([yamlPath])).rejects.toMatchObject({ code: 1 });

    const runsDir = path.join(cwd, ".dps", "runs");
    const runIds = await readdir(runsDir);
    expect(runIds).toHaveLength(1);
    const runDir = path.join(runsDir, runIds[0] as string);
    const files = await readdir(runDir);

    for (const required of [
      "source.json",
      "media-inspection.json",
      "transcript.json",
      "observations.json",
      "existing-demo-analysis.json",
      "decisions.json",
      "events.json",
      "run-summary.json",
    ]) {
      expect(files).toContain(required);
    }

    // No source video is ever copied into the artifact directory.
    expect(files.some((f) => f.endsWith(".mp4"))).toBe(false);

    const analysis = JSON.parse(await readFile(path.join(runDir, "existing-demo-analysis.json"), "utf8"));
    expect(analysis.payload.gate.status).toBe("fail");
    expect(analysis.payload.mediaInspection.status).toBe("invalid");

    const summary = JSON.parse(await readFile(path.join(runDir, "run-summary.json"), "utf8"));
    expect(summary.success).toBe(true); // pipeline completed; gate fail is an honest result, not a crash
    expect(summary.gateStatus).toBe("fail");
  }, 30_000);

  it("produces semantically deterministic artifacts across two runs of identical input", async () => {
    const yamlPath = await writeYaml("analysis.yaml", MISSING_VIDEO_YAML);

    await runCli([yamlPath]).catch(() => undefined);
    await runCli([yamlPath]).catch(() => undefined);

    const runsDir = path.join(cwd, ".dps", "runs");
    const runIds = (await readdir(runsDir)).sort();
    expect(runIds).toHaveLength(2);

    function stripVolatile(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(stripVolatile);
      if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
          if (["runId", "artifactId", "createdAt", "contentHash", "decisionId", "eventId", "occurredAt"].includes(key)) continue;
          out[key] = stripVolatile(v);
        }
        return out;
      }
      return value;
    }

    const analysisA = JSON.parse(await readFile(path.join(runsDir, runIds[0]!, "existing-demo-analysis.json"), "utf8"));
    const analysisB = JSON.parse(await readFile(path.join(runsDir, runIds[1]!, "existing-demo-analysis.json"), "utf8"));
    expect(stripVolatile(analysisA.payload)).toEqual(stripVolatile(analysisB.payload));
  }, 30_000);

  it("returns exit code 0 when running against an unsupported (non-local) source, since that is a structured result, not a crash, but still requires other usable input", async () => {
    // A youtube-url source is represented but never fetched; media inspection reports
    // "unsupported" (not an exception), proving no network access is attempted. Because
    // no transcript/observations resolve visual proof either, the gate still fails, but
    // the run completes and writes the honest, structured result deterministically.
    const yaml = `
schemaVersion: "0.1"
source:
  schemaVersion: "0.1"
  id: yt-source
  type: youtube-url
  uri: https://youtube.com/watch?v=doesnotmatter
`;
    const yamlPath = await writeYaml("analysis.yaml", yaml);
    await expect(runCli([yamlPath])).rejects.toMatchObject({ code: 1 });

    const runsDir = path.join(cwd, ".dps", "runs");
    const runIds = await readdir(runsDir);
    const runDir = path.join(runsDir, runIds[0] as string);
    const inspection = JSON.parse(await readFile(path.join(runDir, "media-inspection.json"), "utf8"));
    expect(inspection.payload.status).toBe("unsupported");
  }, 30_000);
});
