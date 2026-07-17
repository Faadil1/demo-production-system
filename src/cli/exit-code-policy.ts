import type { ExistingDemoAnalysisGateStatus } from "../core/existing-demo-analysis.js";

/**
 * Pure exit-code policy for `analyze-demo`, factored out so it can be unit tested
 * without spawning a subprocess: exit 0 for a pass/conditional gate, non-zero for a
 * pipeline crash (invalid input, inspection exception) or a failed gate.
 */
export function determineExitCode(success: boolean, gateStatus: ExistingDemoAnalysisGateStatus | null): number {
  if (!success) return 1;
  if (gateStatus === "fail") return 1;
  return 0;
}
