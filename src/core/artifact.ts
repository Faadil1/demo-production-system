import type { ArtifactId, ISODateTime, RunId } from "./types.js";

export type ArtifactEnvelope<T> = {
  readonly artifactId: ArtifactId;
  readonly runId: RunId;
  readonly artifactType: string;
  readonly schemaVersion: string;
  readonly producer: {
    readonly name: string;
    readonly version: string;
  };
  readonly createdAt: ISODateTime;
  readonly dependencyArtifactIds: readonly ArtifactId[];
  readonly contentHash: string;
  readonly payload: T;
};

export interface ArtifactRegistry {
  put<T>(artifact: ArtifactEnvelope<T>): Promise<void>;
  get<T>(artifactId: ArtifactId): Promise<ArtifactEnvelope<T> | null>;
  list(runId: RunId): Promise<readonly ArtifactEnvelope<unknown>[]>;
}
