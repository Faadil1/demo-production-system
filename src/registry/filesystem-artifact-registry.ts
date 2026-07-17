import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactEnvelope, ArtifactRegistry } from "../core/artifact.js";
import type { ArtifactId, RunId } from "../core/types.js";

const INDEX_FILENAME = ".artifact-index.json";

export class FilesystemArtifactRegistry implements ArtifactRegistry {
  constructor(private readonly runDir: string) {}

  async put<T>(artifact: ArtifactEnvelope<T>): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    const filePath = this.pathFor(artifact.artifactId);
    await writeFile(filePath, JSON.stringify(artifact, null, 2), "utf8");

    const index = await this.readIndex();
    if (!index.includes(artifact.artifactId)) {
      index.push(artifact.artifactId);
      await writeFile(this.indexPath(), JSON.stringify(index, null, 2), "utf8");
    }
  }

  async get<T>(artifactId: ArtifactId): Promise<ArtifactEnvelope<T> | null> {
    try {
      const raw = await readFile(this.pathFor(artifactId), "utf8");
      return JSON.parse(raw) as ArtifactEnvelope<T>;
    } catch {
      return null;
    }
  }

  async list(runId: RunId): Promise<readonly ArtifactEnvelope<unknown>[]> {
    const index = await this.readIndex();
    const artifacts: ArtifactEnvelope<unknown>[] = [];
    for (const artifactId of index) {
      const artifact = await this.get(artifactId);
      if (artifact && artifact.runId === runId) {
        artifacts.push(artifact);
      }
    }
    return artifacts;
  }

  private pathFor(artifactId: ArtifactId): string {
    return path.join(this.runDir, `${artifactId}.json`);
  }

  private indexPath(): string {
    return path.join(this.runDir, INDEX_FILENAME);
  }

  private async readIndex(): Promise<string[]> {
    try {
      const raw = await readFile(this.indexPath(), "utf8");
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
}
