import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaSource } from "../src/core/media-source.js";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => (execFileMock as (...a: unknown[]) => void)(...args),
}));

const { FfprobeMediaInspector } = await import("../src/adapters/ffprobe-media-inspector.js");

const context = { runId: "run-test", now: () => new Date("2026-07-17T00:00:00Z") };

let tempDir: string;
let videoPath: string;

beforeEach(async () => {
  execFileMock.mockReset();
  tempDir = await mkdtemp(path.join(tmpdir(), "dps-media-"));
  videoPath = path.join(tempDir, "demo.mp4");
  await writeFile(videoPath, "not-a-real-video-just-bytes");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function mockExecFileSuccess(stdout: string): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, callback: (error: unknown, stdout: string) => void) => {
    callback(null, stdout);
  });
}

function mockExecFileError(error: unknown): void {
  execFileMock.mockImplementation((_cmd, _args, _opts, callback: (error: unknown, stdout: string) => void) => {
    callback(error, "");
  });
}

describe("FfprobeMediaInspector", () => {
  it("parses valid ffprobe JSON output into a MediaInspection", async () => {
    mockExecFileSuccess(
      JSON.stringify({
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.5", size: "1024" },
        streams: [
          { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, r_frame_rate: "30/1", pix_fmt: "yuv420p", duration: "12.5" },
          { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, duration: "12.5" },
        ],
      }),
    );

    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: videoPath };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("inspected");
    expect(inspection.durationSeconds).toBe(12.5);
    expect(inspection.videoStreams).toHaveLength(1);
    expect(inspection.videoStreams[0]).toEqual({
      codec: "h264",
      width: 1920,
      height: 1080,
      frameRate: 30,
      pixelFormat: "yuv420p",
      durationSeconds: 12.5,
    });
    expect(inspection.audioStreams).toHaveLength(1);
    expect(inspection.issues).toHaveLength(0);
  });

  it("reports a no-video-stream issue when only audio streams are present", async () => {
    mockExecFileSuccess(
      JSON.stringify({
        format: { format_name: "wav", duration: "5" },
        streams: [{ codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "44100", channels: 1, duration: "5" }],
      }),
    );

    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: videoPath };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("inspected");
    expect(inspection.videoStreams).toHaveLength(0);
    expect(inspection.issues.some((issue) => issue.code === "no-video-stream")).toBe(true);
  });

  it("handles malformed ffprobe JSON output", async () => {
    mockExecFileSuccess("this is not json");

    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: videoPath };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("invalid");
    expect(inspection.issues[0]?.code).toBe("malformed-output");
  });

  it("handles a missing file without invoking ffprobe", async () => {
    const source: MediaSource = {
      schemaVersion: "0.1",
      id: "s1",
      type: "local-video",
      uri: path.join(tempDir, "does-not-exist.mp4"),
    };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("invalid");
    expect(inspection.issues[0]?.code).toBe("file-missing");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("handles ffprobe being unavailable (ENOENT)", async () => {
    const error = Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    mockExecFileError(error);

    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: videoPath };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("unavailable");
    expect(inspection.issues[0]?.code).toBe("ffprobe-not-found");
  });

  it("handles a timeout", async () => {
    const error = Object.assign(new Error("Command timed out"), { killed: true, signal: "SIGTERM" });
    mockExecFileError(error);

    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: videoPath };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir, timeoutMs: 5000 });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("unavailable");
    expect(inspection.issues[0]?.code).toBe("timeout");
  });

  it("returns an unsupported status for youtube-url sources without any filesystem or process access", async () => {
    const source: MediaSource = {
      schemaVersion: "0.1",
      id: "s1",
      type: "youtube-url",
      uri: "https://youtube.com/watch?v=abc123",
    };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("unsupported");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("returns an unsupported status for remote-url sources without any filesystem or process access", async () => {
    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "remote-url", uri: "https://example.com/demo.mp4" };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    const inspection = await inspector.inspect(source, context);

    expect(inspection.status).toBe("unsupported");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("invokes ffprobe with an argument array rather than a shell-concatenated string", async () => {
    mockExecFileSuccess(JSON.stringify({ format: { duration: "1" }, streams: [] }));

    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: videoPath };
    const inspector = new FfprobeMediaInspector({ baseDir: tempDir });
    await inspector.inspect(source, context);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [command, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(command).toBe("ffprobe");
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain(videoPath);
    expect(args).toContain("-show_streams");
  });
});
