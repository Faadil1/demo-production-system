import type { EngineContext } from "../core/engine.js";
import type { MediaInspection } from "../core/media-inspection.js";
import type { MediaSource } from "../core/media-source.js";

/**
 * Replaceable interface for local or future media inspection backends. Per
 * RFC-0003, `youtube-url` and `remote-url` sources must never be fetched here — an
 * implementation that does not support a source type should return `false` from
 * `supports()` so the caller can produce an "unsupported" MediaInspection instead.
 */
export interface MediaInspector {
  readonly name: string;
  readonly version: string;

  supports(source: MediaSource): boolean;

  inspect(source: MediaSource, context: EngineContext): Promise<MediaInspection>;
}
