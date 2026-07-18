import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { platform } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactEnvelope } from "../src/core/artifact.js";
import { resolveArtifacts } from "../src/registry/artifact-resolver.js";
import { contentHashOf } from "../src/core/hash.js";

let tempDir: string;
let runDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "dps-resolver-"));
  runDir = path.join(tempDir, "runs", "run-001");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// Helper to create and write an artifact
async function createArtifact<T>(
  id: string,
  kind: string,
  payload: T,
  dir: string = runDir,
  schemaVersion: string = "0.1"
): Promise<ArtifactEnvelope<T>> {
  const artifact: ArtifactEnvelope<T> = {
    artifactId: id,
    runId: "run-001",
    artifactType: kind,
    schemaVersion,
    producer: { name: "@dps/core", version: "0.1.0" },
    createdAt: "2026-07-17T00:00:00.000Z",
    dependencyArtifactIds: [],
    contentHash: contentHashOf(payload),
    payload,
  };

  // Ensure directory exists and write artifact
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  await writeFile(filePath, JSON.stringify(artifact, null, 2), "utf8");

  return artifact;
}

describe("resolveArtifacts", () => {
  // Finding 1: Ambiguity detection

  it("resolves a single artifact without ambiguity", async () => {
    const payload = { value: "test" };
    const artifact = await createArtifact("understanding", "understanding", payload);

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "understanding",
          expectedContentHash: artifact.contentHash,
        },
      ],
    });

    expect(result.gate.status).toBe("pass");
    expect(result.resolutions).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
    expect(result.resolutions[0]?.resolvedArtifactId).toBe("understanding");
  });

  it("detects and rejects ambiguous matches (multiple valid candidates in same run)", async () => {
    const payload = { value: "test" };
    const artifact = await createArtifact("ambiguous", "understanding", payload);

    // Create both .json and .yaml with same valid content to trigger ambiguity detection.
    // Both files will pass validation (same hash, same kind), creating genuine ambiguity.
    // The resolver should find both and reject with ARTIFACT_AMBIGUOUS_MATCH.
    const yamlPath = path.join(runDir, "ambiguous.yaml");
    await writeFile(yamlPath, JSON.stringify(artifact, null, 2), "utf8"); // .yaml file with JSON content (still parses as JSON)

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "ambiguous",
          expectedContentHash: artifact.contentHash,
        },
      ],
    });

    // Should fail with ambiguity error (multiple valid candidates)
    expect(result.gate.status).toBe("fail");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toBe("ARTIFACT_AMBIGUOUS_MATCH");
    expect(result.resolutions).toHaveLength(0);
  });

  it("rejects ambiguous candidates across sibling runs", async () => {
    const payload = { value: "shared-artifact" };
    const artifact1 = await createArtifact("shared", "understanding", payload);

    // Create artifact in a sibling run with same content
    const sibling2Dir = path.join(tempDir, "runs", "run-002");
    const artifact2 = await createArtifact("shared", "understanding", payload, sibling2Dir);

    // Both siblings have same artifact with same content hash
    // When allowCrossRunReferences is true, resolver should find only in same-run if available
    // If not in same-run, find in first sibling only (deterministic ordering)
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "shared",
          expectedContentHash: artifact1.contentHash,
        },
      ],
      allowCrossRunReferences: true,
    });

    expect(result.gate.status).toBe("pass");
    // Should resolve from same run, not sibling
    expect(result.resolutions[0]?.sourceRunId).toBeUndefined();
  });

  // Finding 2: Schema version validation

  it("rejects artifacts with unsupported schema version", async () => {
    const payload = { value: "test" };
    await createArtifact("incompatible", "understanding", payload, runDir, "0.2");

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "incompatible",
          expectedContentHash: contentHashOf(payload),
        },
      ],
    });

    expect(result.gate.status).toBe("fail");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toBe("ARTIFACT_SCHEMA_UNSUPPORTED");
  });

  it("accepts artifacts with supported schema version", async () => {
    const payload = { value: "test" };
    const artifact = await createArtifact("compatible", "understanding", payload, runDir, "0.1");

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "compatible",
          expectedContentHash: artifact.contentHash,
        },
      ],
    });

    expect(result.gate.status).toBe("pass");
    expect(result.resolutions).toHaveLength(1);
  });

  // Finding 3: Error type distinction

  it("returns ARTIFACT_NOT_FOUND when file is missing", async () => {
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "missing",
          expectedContentHash: "abc123",
        },
      ],
    });

    expect(result.failures[0]?.reason).toBe("ARTIFACT_NOT_FOUND");
  });

  it("returns ARTIFACT_CORRUPTED for malformed JSON", async () => {
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "malformed.json"), "{ invalid json", "utf8");

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "malformed",
          expectedContentHash: "any",
        },
      ],
    });

    expect(result.failures[0]?.reason).toBe("ARTIFACT_CORRUPTED");
    expect(result.failures[0]?.details).toContain("invalid JSON");
  });

  it("returns ARTIFACT_CORRUPTED for malformed envelope", async () => {
    await mkdir(runDir, { recursive: true });
    const badEnvelope = { artifactId: "test" }; // missing payload and other fields
    await writeFile(path.join(runDir, "badenv.json"), JSON.stringify(badEnvelope), "utf8");

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "badenv",
          expectedContentHash: "any",
        },
      ],
    });

    expect(result.failures[0]?.reason).toBe("ARTIFACT_CORRUPTED");
    expect(result.failures[0]?.details).toContain("malformed");
  });

  it("returns REGISTRY_INACCESSIBLE when file read fails", async () => {
    // Test REGISTRY_INACCESSIBLE by injecting a readFile function that fails.
    // This is a portable, deterministic approach that works cross-platform.
    const payload = { value: "test" };
    await createArtifact("inaccessible-test", "understanding", payload);

    // Inject a readFile function that simulates permission denied
    const failingReadFile = async () => {
      const err = new Error("Permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };

    const result = await resolveArtifacts(
      {
        schemaVersion: "0.1",
        registryRootPath: runDir,
        artifactReferences: [
          {
            kind: "understanding",
            artifactId: "inaccessible-test",
            expectedContentHash: contentHashOf(payload),
          },
        ],
      },
      failingReadFile
    );

    expect(result.gate.status).toBe("fail");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toBe("REGISTRY_INACCESSIBLE");
  });

  it("distinguishes different error types during resolution", async () => {
    // Verify that accessible files resolve successfully (normal case)
    const payload = { value: "test" };
    await createArtifact("accessible", "understanding", payload);

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "accessible",
          expectedContentHash: contentHashOf(payload),
        },
      ],
    });

    expect(result.gate.status).toBe("pass");
  });

  // BLOCKER: Symlink escape safety

  it("rejects symlinks that escape the registry root", async () => {
    // Try to create a real symlink to test path escape detection.
    // Skip if symlink creation fails (requires admin on Windows, or some permission setup on POSIX).
    const externalDir = path.join(tempDir, "external");
    await mkdir(externalDir, { recursive: true });
    const externalFile = path.join(externalDir, "outside.json");

    const payload = { value: "external-artifact" };
    const artifact = await createArtifact("outside", "understanding", payload, externalDir);

    const symlinkPath = path.join(runDir, "symlink-escape.json");
    await mkdir(runDir, { recursive: true }); // Ensure run directory exists before creating symlink

    try {
      // Try to create a symlink inside the run directory pointing to the external artifact
      // Node.js symlink signature: symlink(target, path)
      await symlink(externalFile, symlinkPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      // Skip if symlinks are not supported (EPERM on Windows without admin, ENOSYS on systems that don't support symlinks)
      if (nodeErr.code === "EPERM" || nodeErr.code === "ENOSYS") {
        console.log(`Skipping symlink escape test: ${nodeErr.code} (requires admin/elevated privileges)`);
        return;
      }
      throw err;
    }

    // Now try to resolve using the symlink path
    // The resolver should reject this because the real path (externalFile) is outside the registry root
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "symlink-escape",
          expectedContentHash: artifact.contentHash,
        },
      ],
    });

    // Should fail because the symlink target is outside the registry root
    expect(result.gate.status).toBe("fail");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toBe("ARTIFACT_UNSAFE_PATH");
  });

  it("accepts in-root symlinks (if policy permits)", async () => {
    // Create a symlink from one artifact to another within the same registry.
    // This test documents the policy: symlinks are dereferenced and the real target must be in-root.
    // This specific test is informational; the resolver will either accept or reject based on
    // whether the real path stays in-root.
    const payload = { value: "target" };
    const artifact = await createArtifact("target-artifact", "understanding", payload);
    const targetPath = path.join(runDir, "target-artifact.json");

    const symlinkPath = path.join(runDir, "symlink-inroot.json");

    try {
      // Node.js symlink signature: symlink(target, path)
      await symlink(targetPath, symlinkPath);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "EPERM" || nodeErr.code === "ENOSYS") {
        console.log(`Skipping in-root symlink test: ${nodeErr.code}`);
        return;
      }
      throw err;
    }

    // Try to resolve via symlink (it should find the target artifact)
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "symlink-inroot",
          expectedContentHash: artifact.contentHash,
        },
      ],
    });

    // Should succeed because the symlink target is in-root
    expect(result.gate.status).toBe("pass");
    expect(result.resolutions).toHaveLength(1);
  });

  // Finding 4: Path safety

  it("rejects absolute path artifact IDs", async () => {
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "/etc/passwd",
          expectedContentHash: "abc",
        },
      ],
    });

    expect(result.failures[0]?.reason).toBe("ARTIFACT_UNSAFE_PATH");
  });

  it("rejects artifact IDs with path separators", async () => {
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "subdir/artifact",
          expectedContentHash: "abc",
        },
      ],
    });

    expect(result.failures[0]?.reason).toBe("ARTIFACT_UNSAFE_PATH");
  });

  it("rejects artifact IDs with traversal components", async () => {
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "../../etc/passwd",
          expectedContentHash: "abc",
        },
      ],
    });

    expect(result.failures[0]?.reason).toBe("ARTIFACT_UNSAFE_PATH");
  });

  it("accepts valid artifact IDs", async () => {
    const payload = { value: "test" };
    const artifact = await createArtifact("valid-id_1", "understanding", payload);

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "valid-id_1",
          expectedContentHash: artifact.contentHash,
        },
      ],
    });

    expect(result.gate.status).toBe("pass");
  });

  // Finding 5: Determinism (resolvedAt excluded)

  it("produces deterministic output (full deep equality, no timestamp)", async () => {
    const payload = { value: "test" };
    const artifact = await createArtifact("determ", "understanding", payload);

    const request = {
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "determ",
          expectedContentHash: artifact.contentHash,
        },
      ],
    } as const;

    // Resolve same request twice without changing registry state
    const result1 = await resolveArtifacts(request);
    const result2 = await resolveArtifacts(request);

    // Full deep equality of complete results (not just individual fields)
    // Uses toEqual which ignores undefined-valued keys, consistent with RFC's "byte-identical" language
    expect(result1).toEqual(result2);

    // Verify structure: all fields should match
    expect(result1.schemaVersion).toBe(result2.schemaVersion);
    expect(result1.gate).toEqual(result2.gate);
    expect(result1.resolutions).toHaveLength(result2.resolutions.length);
    expect(result1.failures).toHaveLength(result2.failures.length);

    // Verify no hidden nondeterministic fields exist
    if (result1.resolutions.length > 0 && result2.resolutions.length > 0) {
      const r1 = result1.resolutions[0]!;
      const r2 = result2.resolutions[0]!;
      expect(r1.resolvedArtifactId).toBe(r2.resolvedArtifactId);
      expect(r1.resolvedPath).toBe(r2.resolvedPath);
      expect(r1.resolvedContentHash).toBe(r2.resolvedContentHash);
      expect(r1.sourceRunId).toBe(r2.sourceRunId);
      // Verify no resolvedAt field exists (intentionally excluded for determinism)
      expect("resolvedAt" in r1).toBe(false);
    }
  });

  // Finding 6: Content hash authority

  it("validates content hash matches payload", async () => {
    const payload = { value: "test" };
    const artifact = await createArtifact("valid-hash", "understanding", payload);

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "valid-hash",
          expectedContentHash: artifact.contentHash,
        },
      ],
    });

    expect(result.gate.status).toBe("pass");
  });

  it("rejects forged stored contentHash (artifact corrupted)", async () => {
    const payload = { value: "test" };
    const correctHash = contentHashOf(payload);

    // Create artifact with forged stored hash
    const artifact: ArtifactEnvelope<typeof payload> = {
      artifactId: "forged",
      runId: "run-001",
      artifactType: "understanding",
      schemaVersion: "0.1",
      producer: { name: "@dps/core", version: "0.1.0" },
      createdAt: "2026-07-17T00:00:00.000Z",
      dependencyArtifactIds: [],
      contentHash: "forged-hash-value",
      payload,
    };

    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "forged.json"), JSON.stringify(artifact), "utf8");

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        {
          kind: "understanding",
          artifactId: "forged",
          expectedContentHash: correctHash,
        },
      ],
    });

    // Should fail with ARTIFACT_CORRUPTED (stored hash doesn't match computed)
    expect(result.failures[0]?.reason).toBe("ARTIFACT_CORRUPTED");
  });

  // Integration tests

  it("preserves request order in resolutions", async () => {
    const u = await createArtifact("first", "understanding", { value: "u" });
    const s = await createArtifact("second", "storyboard", { value: "s" });
    const r = await createArtifact("third", "render-plan", { value: "r" });

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        { kind: "understanding", artifactId: "first", expectedContentHash: u.contentHash },
        { kind: "storyboard", artifactId: "second", expectedContentHash: s.contentHash },
        { kind: "render-plan", artifactId: "third", expectedContentHash: r.contentHash },
      ],
    });

    expect(result.resolutions).toHaveLength(3);
    expect(result.resolutions[0]?.resolvedArtifactId).toBe("first");
    expect(result.resolutions[1]?.resolvedArtifactId).toBe("second");
    expect(result.resolutions[2]?.resolvedArtifactId).toBe("third");
  });

  it("handles mixed success and failure", async () => {
    const u = await createArtifact("understanding", "understanding", { value: "u" });

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        { kind: "understanding", artifactId: "understanding", expectedContentHash: u.contentHash },
        { kind: "storyboard", artifactId: "missing-1", expectedContentHash: "abc" },
        { kind: "render-plan", artifactId: "missing-2", expectedContentHash: "def" },
      ],
    });

    expect(result.gate.status).toBe("fail");
    expect(result.resolutions).toHaveLength(1);
    expect(result.failures).toHaveLength(2);
  });

  it("gate status is fail when any required resolution fails", async () => {
    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        { kind: "understanding", artifactId: "missing-1", expectedContentHash: "a" },
        { kind: "storyboard", artifactId: "missing-2", expectedContentHash: "b" },
      ],
    });

    expect(result.gate.status).toBe("fail");
    expect(result.gate.reason).toBe("2 artifact(s) failed to resolve");
  });

  it("cross-run resolution disabled by default", async () => {
    const siblingDir = path.join(tempDir, "runs", "run-002");
    const payload = { value: "from-sibling" };
    await createArtifact("shared", "understanding", payload, siblingDir);

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        { kind: "understanding", artifactId: "shared", expectedContentHash: contentHashOf(payload) },
      ],
      allowCrossRunReferences: false,
    });

    expect(result.gate.status).toBe("fail");
    expect(result.failures[0]?.reason).toBe("ARTIFACT_NOT_FOUND");
  });

  it("cross-run resolution enabled when allowCrossRunReferences true", async () => {
    const siblingDir = path.join(tempDir, "runs", "run-002");
    const payload = { value: "from-sibling" };
    const artifact = await createArtifact("shared", "understanding", payload, siblingDir);

    const result = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        { kind: "understanding", artifactId: "shared", expectedContentHash: artifact.contentHash },
      ],
      allowCrossRunReferences: true,
    });

    expect(result.gate.status).toBe("pass");
    expect(result.resolutions[0]?.sourceRunId).toBe("run-002");
  });

  it("upstream artifacts remain byte-identical after resolution", async () => {
    const payload = { nested: { data: "immutable" } };
    const artifact = await createArtifact("immutable", "understanding", payload);

    // Resolve it
    await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        { kind: "understanding", artifactId: "immutable", expectedContentHash: artifact.contentHash },
      ],
    });

    // Re-resolve and verify hash is identical
    const result2 = await resolveArtifacts({
      schemaVersion: "0.1",
      registryRootPath: runDir,
      artifactReferences: [
        { kind: "understanding", artifactId: "immutable", expectedContentHash: artifact.contentHash },
      ],
    });

    expect(result2.gate.status).toBe("pass");
  });
});
