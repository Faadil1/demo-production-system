import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemArtifactRegistry } from "../src/registry/filesystem-artifact-registry.js";
import type { ArtifactEnvelope } from "../src/core/artifact.js";

let runDir: string;

beforeEach(async () => {
  runDir = await mkdtemp(path.join(tmpdir(), "dps-registry-"));
});

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

describe("FilesystemArtifactRegistry", () => {
  it("round-trips an artifact by id and lists artifacts scoped to a run", async () => {
    const registry = new FilesystemArtifactRegistry(runDir);
    const artifact: ArtifactEnvelope<{ readonly value: string }> = {
      artifactId: "manifest",
      runId: "run-1",
      artifactType: "demo-manifest",
      schemaVersion: "0.1",
      producer: { name: "@dps/core", version: "0.1.0" },
      createdAt: "2026-07-17T00:00:00.000Z",
      dependencyArtifactIds: [],
      contentHash: "deadbeef",
      payload: { value: "hello" },
    };

    await registry.put(artifact);

    const fetched = await registry.get<{ readonly value: string }>("manifest");
    expect(fetched).toEqual(artifact);

    const listed = await registry.list("run-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.artifactId).toBe("manifest");
  });

  it("returns null for an unknown artifact id", async () => {
    const registry = new FilesystemArtifactRegistry(runDir);
    expect(await registry.get("missing")).toBeNull();
  });
});
