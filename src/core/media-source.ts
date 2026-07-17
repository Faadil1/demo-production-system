import path from "node:path";

export type MediaSourceType = "local-video" | "youtube-url" | "remote-url";

export type MediaSource = {
  readonly schemaVersion: "0.1";
  readonly id: string;
  readonly type: MediaSourceType;
  readonly uri: string;
  readonly label?: string;
};

const URL_LIKE_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Resolves a `local-video` source's URI to an absolute filesystem path, relative to
 * `baseDir` when not already absolute. Refuses non-local source types and refuses any
 * URI that looks like a URL, so a remote/YouTube source can never be silently treated
 * as a local file.
 */
export function resolveLocalVideoPath(source: MediaSource, baseDir: string): string {
  if (source.type !== "local-video") {
    throw new Error(
      `Cannot resolve a local filesystem path for source type "${source.type}"; only "local-video" sources reference a local file.`,
    );
  }
  if (URL_LIKE_PATTERN.test(source.uri) || source.uri.startsWith("//")) {
    throw new Error(
      `Refusing to treat URI "${source.uri}" as a local file path; it looks like a URL.`,
    );
  }
  return path.isAbsolute(source.uri) ? path.normalize(source.uri) : path.resolve(baseDir, source.uri);
}
