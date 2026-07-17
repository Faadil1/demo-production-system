import type { ArtifactEnvelope } from "../core/artifact.js";
import { contentHashOf } from "../core/hash.js";

export const DPS_PRODUCER = { name: "@dps/core", version: "0.1.0" } as const;

/** Shared envelope builder reused by every CLI pipeline (demo, analyze-demo, ...). */
export function buildArtifactEnvelope<T>(args: {
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
    producer: DPS_PRODUCER,
    createdAt: args.createdAt,
    dependencyArtifactIds: args.dependencyArtifactIds,
    contentHash: contentHashOf(args.payload),
    payload: args.payload,
  };
}
