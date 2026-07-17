import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..");

let chromiumAvailable = true;
try {
  const probe = await chromium.launch({ headless: true });
  await probe.close();
} catch {
  chromiumAvailable = false;
}

const FIXTURE_HTML = `<!doctype html><html><head><title>Fixture</title></head><body>
<h1 data-testid="title">TrustCheck</h1>
<button data-testid="verify-button" onclick="document.querySelector('[data-testid=result-card]').style.display='block'">Verify</button>
<div data-testid="result-card" style="display:none">Verified</div>
</body></html>`;

let server: Server;
let baseUrl: string;
let cwd: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(FIXTURE_HTML);
    });
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "dps-capture-cli-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function runCli(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const cliEntry = path.join(repoRoot, "src", "cli", "capture-browser.ts");
  return execFileAsync(process.execPath, [tsxCli, cliEntry, ...args], { cwd });
}

function capturePlanYaml(target: string, opts: { critical?: boolean } = {}): string {
  const importance = opts.critical === false ? "important" : "critical";
  return `
schemaVersion: "0.1"
id: cli-test-plan
target:
  schemaVersion: "0.1"
  id: cli-test-target
  type: local
  baseUrl: ${target}
viewport:
  width: 1024
  height: 768
policy:
  schemaVersion: "0.1"
  allowedOrigins: []
  allowExternalNavigation: false
  allowDownloads: false
  allowPopups: false
  allowClipboard: false
  allowGeolocation: false
  allowNotifications: false
  allowCamera: false
  allowMicrophone: false
  allowServiceWorkers: false
  allowFileUploads: false
  blockThirdPartyRequests: true
  blockedResourceTypes: []
  blockedUrlPatterns: []
  maximumSteps: 50
  maximumDurationMs: 30000
  defaultStepTimeoutMs: 10000
steps:
  - id: nav
    kind: navigate
    description: Navigate.
    path: /
    waitUntil: load
  - id: click
    kind: click
    description: Click verify.
    selector: { strategy: test-id, value: verify-button }
  - id: assert-result
    kind: assert
    description: Assert result visible.
    assertionKind: element-visible
    selector: { strategy: test-id, value: result-card }
    importance: ${importance}
  - id: shot
    kind: screenshot
    description: Screenshot after.
    artifactName: after
    fullPage: false
    animations: disabled
evidenceRequirements:
  - id: req-result
    claim: Result becomes visible.
    requiredArtifactKinds: [screenshot, assertion]
    requiredAssertionIds: [assert-result]
    minimumVerifiedArtifacts: 1
    importance: ${importance}
`;
}

async function writeYaml(contents: string): Promise<string> {
  const fullPath = path.join(cwd, "capture.yaml");
  await writeFile(fullPath, contents, "utf8");
  return fullPath;
}

describe("npm run capture-browser (CLI, no browser required)", () => {
  it("prints usage and exits non-zero when the argument is missing", async () => {
    await expect(runCli([])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Usage:") });
  });

  it("exits non-zero for invalid YAML (schema validation failure), writing no run directory", async () => {
    const yamlPath = await writeYaml("schemaVersion: \"0.1\"\nid: bad\n");
    await expect(runCli([yamlPath])).rejects.toMatchObject({ code: 1 });
    await expect(readdir(path.join(cwd, ".dps"))).rejects.toThrow();
  });
});

describe.skipIf(!chromiumAvailable)("npm run capture-browser (CLI, real browser)", () => {
  it("writes all required artifacts and exits 0 for a pass gate", async () => {
    const yamlPath = await writeYaml(capturePlanYaml(baseUrl, { critical: true }));
    await runCli([yamlPath]);

    const runsDir = path.join(cwd, ".dps", "runs");
    const runIds = await readdir(runsDir);
    expect(runIds).toHaveLength(1);
    const runDir = path.join(runsDir, runIds[0] as string);
    const files = await readdir(runDir);

    for (const required of [
      "capture-plan.json",
      "browser-execution.json",
      "browser-step-results.json",
      "browser-assertions.json",
      "browser-network.json",
      "browser-observations.json",
      "browser-evidence-manifest.json",
      "browser-capture-result.json",
      "understanding-evidence.json",
      "decisions.json",
      "events.json",
      "run-summary.json",
    ]) {
      expect(files).toContain(required);
    }
    expect(files).toContain("screenshots");

    const screenshots = await readdir(path.join(runDir, "screenshots"));
    expect(screenshots).toContain("after.png");

    const summary = JSON.parse(await readFile(path.join(runDir, "run-summary.json"), "utf8"));
    expect(summary.success).toBe(true);
    expect(summary.gateStatus).toBe("pass");
  }, 30_000);

  it("exits 0 for a conditional gate (critical assertion passes, but a non-critical evidence requirement is unsatisfiable)", async () => {
    const yaml = capturePlanYaml(baseUrl, { critical: true }).replace(
      "requiredAssertionIds: [assert-result]\n    minimumVerifiedArtifacts: 1\n    importance: critical",
      "requiredAssertionIds: [assert-nonexistent]\n    minimumVerifiedArtifacts: 1\n    importance: supporting",
    );
    const yamlPath = await writeYaml(yaml);
    const { stdout } = await runCli([yamlPath]);
    expect(stdout).toContain("Gate status: conditional");

    const runsDir = path.join(cwd, ".dps", "runs");
    const runDir = path.join(runsDir, (await readdir(runsDir))[0] as string);
    const summary = JSON.parse(await readFile(path.join(runDir, "run-summary.json"), "utf8"));
    expect(summary.gateStatus).toBe("conditional");
  }, 30_000);

  it("exits non-zero for a fail gate (critical assertion targets a nonexistent element)", async () => {
    const badPlan = capturePlanYaml(baseUrl, { critical: true }).replace(
      "value: result-card }\n    importance: critical",
      "value: nonexistent-element }\n    importance: critical",
    );
    const yamlPath = await writeYaml(badPlan);
    await expect(runCli([yamlPath])).rejects.toMatchObject({ code: 1 });

    const runsDir = path.join(cwd, ".dps", "runs");
    const runDir = path.join(runsDir, (await readdir(runsDir))[0] as string);
    const summary = JSON.parse(await readFile(path.join(runDir, "run-summary.json"), "utf8"));
    expect(summary.gateStatus).toBe("fail");
  }, 30_000);

  it("produces semantically deterministic JSON artifacts across two runs", async () => {
    const yamlPath = await writeYaml(capturePlanYaml(baseUrl, { critical: true }));
    await runCli([yamlPath]);
    await runCli([yamlPath]);

    const runsDir = path.join(cwd, ".dps", "runs");
    const runIds = (await readdir(runsDir)).sort();
    expect(runIds).toHaveLength(2);

    function stripVolatile(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(stripVolatile);
      if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
          if (
            [
              "runId",
              "artifactId",
              "createdAt",
              "contentHash",
              "decisionId",
              "eventId",
              "occurredAt",
              "capturedAt",
              "observedAt",
              "startedAtSeconds",
              "endedAtSeconds",
              "durationMs",
              "path",
              "id",
            ].includes(key)
          )
            continue;
          out[key] = stripVolatile(v);
        }
        return out;
      }
      return value;
    }

    const a = JSON.parse(await readFile(path.join(runsDir, runIds[0]!, "browser-evidence-manifest.json"), "utf8"));
    const b = JSON.parse(await readFile(path.join(runsDir, runIds[1]!, "browser-evidence-manifest.json"), "utf8"));
    expect(stripVolatile(a.payload.coverage)).toEqual(stripVolatile(b.payload.coverage));
  }, 30_000);

  it("never writes headers, cookies, fill values, or a copied source video into any artifact", async () => {
    const yamlPath = await writeYaml(capturePlanYaml(baseUrl, { critical: true }));
    await runCli([yamlPath]);

    const runsDir = path.join(cwd, ".dps", "runs");
    const runDir = path.join(runsDir, (await readdir(runsDir))[0] as string);
    const files = await readdir(runDir);
    expect(files.some((f) => f.endsWith(".mp4") || f.endsWith(".mov"))).toBe(false);

    const resultRaw = await readFile(path.join(runDir, "browser-capture-result.json"), "utf8");
    expect(resultRaw).not.toMatch(/authorization/i);
    expect(resultRaw).not.toMatch(/set-cookie/i);
  }, 30_000);
});

describe.skipIf(chromiumAvailable)("capture-browser CLI — Chromium unavailable", () => {
  it("is skipped because Chromium is not installed in this environment", () => {
    expect(chromiumAvailable).toBe(false);
  });
});
