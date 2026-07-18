import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBundle, defaultAdapterCapabilities, ONE_PX_PNG_BASE64, twoSceneStoryboard } from "./fixtures/render-fixtures.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "dps-compile-render-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cliEntry = path.join(repoRoot, "src", "cli", "compile-render.ts");

async function runCli(inputFile: string): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const args = inputFile ? [tsxCli, cliEntry, inputFile] : [tsxCli, cliEntry];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? 1 };
  }
}

async function latestRunDir(): Promise<string> {
  const runsDir = path.join(cwd, ".dps", "runs");
  const entries = await readdir(runsDir);
  return path.join(runsDir, entries.sort()[entries.length - 1]!);
}

describe("npm run compile-render (CLI)", () => {
  it("prints usage and exits non-zero when the input path argument is missing", async () => {
    const result = await runCli("");
    // execFileAsync with an empty final arg still passes an empty string arg; the CLI
    // treats a missing/falsy argv[2] identically.
    expect(result.exitCode).not.toBe(0);
  });

  it("Case A: exits 1 and emits only a RenderRejection when the Story Gate fails", async () => {
    const storyboard = { ...twoSceneStoryboard(), gate: { status: "fail" as const, blockingReasons: ["narrative gap"], warnings: [], requirementsBeforeRender: [] } };
    const bundle = buildBundle({ storyboard });
    const inputPath = path.join(cwd, "input.json");
    await writeFile(inputPath, JSON.stringify(bundle), "utf8");

    const result = await runCli(inputPath);
    expect(result.exitCode).toBe(1);

    const runDir = await latestRunDir();
    const rejection = JSON.parse(await readFile(path.join(runDir, "render-rejection.json"), "utf8"));
    expect(rejection.payload.status).toBe("rejected");
    await expect(readFile(path.join(runDir, "render-plan.json"), "utf8")).rejects.toThrow();
  });

  it("Case B: exits 1 but still persists resolved-assets and the render-plan when the gate fails", async () => {
    const storyboard = twoSceneStoryboard();
    const caps = defaultAdapterCapabilities({ supportedMediaTypes: [] });
    const bundle = buildBundle({
      storyboard,
      adapterCapabilities: caps,
      assetCandidates: [
        {
          id: "cand-1",
          evidenceRefId: "ev-1",
          source: { kind: "artifact", sourceArtifactId: "artifact-cand-1" },
          declaredMediaType: "image/png",
          bytesBase64: ONE_PX_PNG_BASE64,
        },
      ],
      assetBindingRequests: [
        {
          id: "b1",
          storyboardSceneId: "scene-a",
          renderLayerId: "layer-b1",
          evidenceRefId: "ev-1",
          role: "primary",
          criticality: "required",
          acceptableMediaTypes: ["image/png"],
          geometry: { xPx: 200, yPx: 200, widthPx: 400, heightPx: 300 },
          zIndex: 0,
        },
      ],
    });
    const inputPath = path.join(cwd, "input.json");
    await writeFile(inputPath, JSON.stringify(bundle), "utf8");

    const result = await runCli(inputPath);
    expect(result.exitCode).toBe(1);

    const runDir = await latestRunDir();
    const plan = JSON.parse(await readFile(path.join(runDir, "render-plan.json"), "utf8"));
    const gate = JSON.parse(await readFile(path.join(runDir, "render-gate.json"), "utf8"));
    const assets = JSON.parse(await readFile(path.join(runDir, "resolved-assets.json"), "utf8"));
    expect(plan.payload.id).toBeTruthy();
    expect(gate.payload.status).toBe("fail");
    expect(assets.payload.length).toBe(1);
  });

  it("Case C: exits 0 and emits resolved-assets + plan + a pass gate", async () => {
    const storyboard = twoSceneStoryboard();
    const bundle = buildBundle({ storyboard });
    const inputPath = path.join(cwd, "input.json");
    await writeFile(inputPath, JSON.stringify(bundle), "utf8");

    const result = await runCli(inputPath);
    expect(result.exitCode).toBe(0);

    const runDir = await latestRunDir();
    const gate = JSON.parse(await readFile(path.join(runDir, "render-gate.json"), "utf8"));
    expect(gate.payload.status).toBe("pass");
  });
});
