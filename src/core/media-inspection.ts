import type { SourceType } from "./provenance.js";

export type MediaInspectionStatus = "inspected" | "unsupported" | "unavailable" | "invalid";

export type VideoStreamInfo = {
  readonly codec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly frameRate: number | null;
  readonly pixelFormat: string | null;
  readonly durationSeconds: number | null;
};

export type AudioStreamInfo = {
  readonly codec: string | null;
  readonly sampleRate: number | null;
  readonly channels: number | null;
  readonly durationSeconds: number | null;
};

export type MediaInspectionIssue = {
  readonly code: string;
  readonly message: string;
};

export type MediaInspection = {
  readonly schemaVersion: "0.1";
  readonly sourceId: string;
  readonly status: MediaInspectionStatus;
  readonly containerFormat: string | null;
  readonly durationSeconds: number | null;
  readonly fileSizeBytes: number | null;
  readonly videoStreams: readonly VideoStreamInfo[];
  readonly audioStreams: readonly AudioStreamInfo[];
  readonly issues: readonly MediaInspectionIssue[];
  readonly provenance: {
    readonly inspector: string;
    readonly inspectorVersion: string;
    readonly sourceType: SourceType;
  };
};
