import { createHash } from "node:crypto";
import { stableStringify } from "./stable-json.js";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function contentHashOf(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}
