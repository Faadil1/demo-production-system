import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(repoRoot, "examples", "minimal", "demo.yaml");

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "dps-cli-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("npm run demo (integration)", () => {
  it("produces the required artifact files for a valid manifest", async () => {
    const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const cliEntry = path.join(repoRoot, "src", "cli", "demo.ts");

    await execFileAsync(process.execPath, [tsxCli, cliEntry, manifestPath], { cwd });

    const runsDir = path.join(cwd, ".dps", "runs");
    const runIds = await readdir(runsDir);
    expect(runIds).toHaveLength(1);

    const runDir = path.join(runsDir, runIds[0] as string);
    const files = await readdir(runDir);
    for (const required of [
      "manifest.json",
      "understanding.json",
      "plan.json",
      "dir.json",
      "decisions.json",
      "events.json",
      "run-summary.json",
    ]) {
      expect(files).toContain(required);
    }

    const summary = JSON.parse(await readFile(path.join(runDir, "run-summary.json"), "utf8"));
    expect(summary.success).toBe(true);
    expect(summary.artifacts.length).toBe(4);

    const dir = JSON.parse(await readFile(path.join(runDir, "dir.json"), "utf8"));
    expect(dir.payload.scenes.filter((scene: { isHeroInteraction: boolean }) => scene.isHeroInteraction)).toHaveLength(1);
  }, 30_000);

  it("fails before engine execution for an invalid manifest and writes no run directory", async () => {
    const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const cliEntry = path.join(repoRoot, "src", "cli", "demo.ts");
    const invalidManifest = path.join(cwd, "invalid-demo.yaml");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(
        invalidManifest,
        'schemaVersion: "0.1"\nproject:\n  name: X\ndemo:\n  goal: prove\n  audience: a\n  durationSeconds: 5\n  mode: directed\n',
        "utf8",
      ),
    );

    await expect(
      execFileAsync(process.execPath, [tsxCli, cliEntry, invalidManifest], { cwd }),
    ).rejects.toMatchObject({
      code: 1,
    });

    await expect(readdir(path.join(cwd, ".dps"))).rejects.toThrow();
  }, 30_000);
});
