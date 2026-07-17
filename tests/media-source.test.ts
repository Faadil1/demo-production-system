import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLocalVideoPath, type MediaSource } from "../src/core/media-source.js";

describe("resolveLocalVideoPath", () => {
  it("accepts a local-video source and resolves a relative uri against baseDir", () => {
    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: "./demo.mp4" };
    const resolved = resolveLocalVideoPath(source, "/base/dir");
    expect(resolved).toBe(path.resolve("/base/dir", "./demo.mp4"));
  });

  it("resolves an already-absolute uri as-is", () => {
    const absolute = path.resolve("/somewhere/demo.mp4");
    const source: MediaSource = { schemaVersion: "0.1", id: "s1", type: "local-video", uri: absolute };
    expect(resolveLocalVideoPath(source, "/base/dir")).toBe(path.normalize(absolute));
  });

  it("refuses to resolve a youtube-url source as a local path", () => {
    const source: MediaSource = {
      schemaVersion: "0.1",
      id: "s2",
      type: "youtube-url",
      uri: "https://youtube.com/watch?v=abc123",
    };
    expect(() => resolveLocalVideoPath(source, "/base/dir")).toThrow(/only "local-video"/);
  });

  it("refuses to resolve a remote-url source as a local path", () => {
    const source: MediaSource = { schemaVersion: "0.1", id: "s3", type: "remote-url", uri: "https://example.com/demo.mp4" };
    expect(() => resolveLocalVideoPath(source, "/base/dir")).toThrow(/only "local-video"/);
  });

  it("refuses a local-video source whose uri looks like a URL, even though the type claims local", () => {
    const source: MediaSource = {
      schemaVersion: "0.1",
      id: "s4",
      type: "local-video",
      uri: "https://example.com/demo.mp4",
    };
    expect(() => resolveLocalVideoPath(source, "/base/dir")).toThrow(/looks like a URL/);
  });

  it("treats a path containing shell metacharacters as a literal filename, not a command", () => {
    // No path separators in the dangerous name, so it survives path.resolve() as a
    // single literal path segment rather than being reinterpreted as directory structure.
    const dangerousName = "demo;rm-rf;$(echo pwned)&&whoami.mp4";
    const source: MediaSource = { schemaVersion: "0.1", id: "s5", type: "local-video", uri: `./${dangerousName}` };
    const resolved = resolveLocalVideoPath(source, "/base/dir");
    expect(resolved).toBe(path.resolve("/base/dir", `./${dangerousName}`));
    expect(resolved.endsWith(dangerousName)).toBe(true);
  });
});
