import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import type { EngineContext } from "../core/engine.js";
import type {
  AudioStreamInfo,
  MediaInspection,
  MediaInspectionIssue,
  VideoStreamInfo,
} from "../core/media-inspection.js";
import { resolveLocalVideoPath, type MediaSource } from "../core/media-source.js";
import type { MediaInspector } from "./media-inspector.js";

export type FfprobeMediaInspectorOptions = {
  readonly ffprobePath?: string;
  readonly timeoutMs?: number;
  readonly baseDir?: string;
};

type FfprobeStream = {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly r_frame_rate?: string;
  readonly pix_fmt?: string;
  readonly sample_rate?: string;
  readonly channels?: number;
  readonly duration?: string;
};

type FfprobeFormat = {
  readonly format_name?: string;
  readonly duration?: string;
  readonly size?: string;
};

type FfprobeOutput = {
  readonly format?: FfprobeFormat;
  readonly streams?: readonly FfprobeStream[];
};

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split("/");
  const num = Number(parts[0]);
  if (!Number.isFinite(num)) return null;
  if (parts.length < 2) return num;
  const den = Number(parts[1]);
  if (!Number.isFinite(den) || den === 0) return num;
  return num / den;
}

function toNumberOrNull(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Deterministic, local, network-free media inspection backed by `ffprobe`. Executes via
 * `execFile` with an argument array (never shell-concatenated), requests JSON metadata
 * only, and never generates screenshots or frames. All failure modes are returned as a
 * structured `MediaInspection` rather than thrown, except for programmer errors.
 */
export class FfprobeMediaInspector implements MediaInspector {
  readonly name = "ffprobe-media-inspector";
  readonly version = "0.1.0";

  private readonly ffprobePath: string;
  private readonly timeoutMs: number;
  private readonly baseDir: string;

  constructor(options: FfprobeMediaInspectorOptions = {}) {
    this.ffprobePath = options.ffprobePath ?? "ffprobe";
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.baseDir = options.baseDir ?? process.cwd();
  }

  supports(source: MediaSource): boolean {
    return source.type === "local-video";
  }

  async inspect(source: MediaSource, _context: EngineContext): Promise<MediaInspection> {
    const provenance = { inspector: this.name, inspectorVersion: this.version, sourceType: "capture" as const };
    const empty = {
      schemaVersion: "0.1" as const,
      sourceId: source.id,
      containerFormat: null,
      durationSeconds: null,
      videoStreams: [] as const,
      audioStreams: [] as const,
      provenance,
    };

    if (!this.supports(source)) {
      return {
        ...empty,
        status: "unsupported",
        fileSizeBytes: null,
        issues: [
          {
            code: "unsupported-source-type",
            message: `Media source type "${source.type}" is not inspectable locally in RFC-0003; only "local-video" is supported. Remote sources are never fetched.`,
          },
        ],
      };
    }

    let filePath: string;
    try {
      filePath = resolveLocalVideoPath(source, this.baseDir);
    } catch (error) {
      return {
        ...empty,
        status: "invalid",
        fileSizeBytes: null,
        issues: [{ code: "invalid-source-uri", message: error instanceof Error ? error.message : String(error) }],
      };
    }

    let fileSizeBytes: number;
    try {
      const stats = await stat(filePath);
      fileSizeBytes = stats.size;
    } catch {
      return {
        ...empty,
        status: "invalid",
        fileSizeBytes: null,
        issues: [{ code: "file-missing", message: `No file exists at "${filePath}".` }],
      };
    }

    let stdout: string;
    try {
      stdout = await this.runFfprobe(filePath);
    } catch (error) {
      const { status, issue } = this.classifyFfprobeError(error);
      return { ...empty, status, fileSizeBytes, issues: [issue] };
    }

    let parsed: FfprobeOutput;
    try {
      parsed = JSON.parse(stdout) as FfprobeOutput;
    } catch {
      return {
        ...empty,
        status: "invalid",
        fileSizeBytes,
        issues: [{ code: "malformed-output", message: "ffprobe output could not be parsed as JSON." }],
      };
    }

    const videoStreams: VideoStreamInfo[] = (parsed.streams ?? [])
      .filter((stream) => stream.codec_type === "video")
      .map((stream) => ({
        codec: stream.codec_name ?? null,
        width: toNumberOrNull(stream.width),
        height: toNumberOrNull(stream.height),
        frameRate: parseFrameRate(stream.r_frame_rate),
        pixelFormat: stream.pix_fmt ?? null,
        durationSeconds: toNumberOrNull(stream.duration),
      }));

    const audioStreams: AudioStreamInfo[] = (parsed.streams ?? [])
      .filter((stream) => stream.codec_type === "audio")
      .map((stream) => ({
        codec: stream.codec_name ?? null,
        sampleRate: toNumberOrNull(stream.sample_rate),
        channels: toNumberOrNull(stream.channels),
        durationSeconds: toNumberOrNull(stream.duration),
      }));

    const issues: MediaInspectionIssue[] = [];
    if (videoStreams.length === 0) {
      issues.push({ code: "no-video-stream", message: "No video stream was found in the media file." });
    }

    return {
      schemaVersion: "0.1",
      sourceId: source.id,
      status: "inspected",
      containerFormat: parsed.format?.format_name ?? null,
      durationSeconds: toNumberOrNull(parsed.format?.duration),
      fileSizeBytes,
      videoStreams,
      audioStreams,
      issues,
      provenance,
    };
  }

  private runFfprobe(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.ffprobePath,
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
        { timeout: this.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  private classifyFfprobeError(error: unknown): {
    readonly status: "unavailable" | "invalid";
    readonly issue: MediaInspectionIssue;
  } {
    const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
    if (err.code === "ENOENT") {
      return {
        status: "unavailable",
        issue: { code: "ffprobe-not-found", message: "The ffprobe executable was not found on PATH." },
      };
    }
    if (err.killed === true || err.signal === "SIGTERM") {
      return {
        status: "unavailable",
        issue: { code: "timeout", message: `ffprobe did not complete within ${this.timeoutMs}ms.` },
      };
    }
    return {
      status: "invalid",
      issue: {
        code: "ffprobe-failed",
        message: `ffprobe reported an error: ${(err.message ?? "unknown error").slice(0, 500)}`,
      },
    };
  }
}
