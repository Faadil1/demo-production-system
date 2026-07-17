export type SourceType =
  | "manifest"
  | "repository"
  | "documentation"
  | "capture"
  | "runtime"
  | "human"
  | "inference";

export type VerificationStatus =
  | "unverified"
  | "partially-verified"
  | "verified"
  | "contradicted";

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
