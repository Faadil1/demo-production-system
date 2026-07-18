// RFC-0006 §18 — asset integrity validation: media type detection from bytes (magic-byte
// sniffing), never from filename extension alone. This is an honest, narrow reference
// implementation: it recognizes the container/format signature for every `RenderMediaType`
// in the v0.1 closed union, but does not decode pixel/audio/video payloads (full codec
// decoding is out of scope for RFC-0006 — see docs/implementation/rfc-0006-implementation.md
// Known Limitations).
import type { RenderMediaType } from "./render.js";

export function detectMediaType(bytes: Buffer): RenderMediaType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "audio/wav";
  }
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio/mp3";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) {
    return "audio/mp3";
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "video/mp4";
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "video/webm";
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return "font/ttf";
  }
  if (bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) {
    return "font/woff2";
  }
  return null;
}
export type MediaStructure = {
  readonly valid: boolean;
  readonly widthPx?: number;
  readonly heightPx?: number;
};

/** Minimum deterministic structural validation; no decode/render work is performed. */
export function inspectMediaStructure(bytes: Buffer, mediaType: RenderMediaType): MediaStructure {
  switch (mediaType) {
    case "image/png": {
      if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return { valid: false };
      const widthPx = bytes.readUInt32BE(16);
      const heightPx = bytes.readUInt32BE(20);
      return widthPx > 0 && heightPx > 0 ? { valid: true, widthPx, heightPx } : { valid: false };
    }
    case "image/jpeg":
      return { valid: bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9 };
    case "image/webp":
      return { valid: bytes.length >= 20 && bytes.readUInt32LE(4) + 8 === bytes.length };
    case "audio/wav":
      return { valid: bytes.length >= 44 && bytes.readUInt32LE(4) + 8 === bytes.length };
    case "audio/mp3":
      return { valid: bytes.length >= 10 };
    case "video/mp4":
      return { valid: bytes.length >= 16 && bytes.readUInt32BE(0) >= 8 && bytes.readUInt32BE(0) <= bytes.length };
    case "video/webm":
      return { valid: bytes.length >= 8 };
    case "font/ttf":
      return { valid: bytes.length >= 12 };
    case "font/woff2":
      return { valid: bytes.length >= 48 && bytes.readUInt32BE(8) === bytes.length };
  }
}
