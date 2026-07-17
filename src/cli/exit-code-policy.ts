export type GateStatus = "pass" | "conditional" | "fail";

/**
 * Pure exit-code policy shared by every gate-driven CLI (`analyze-demo`,
 * `capture-browser`, ...), factored out so it can be unit tested without spawning a
 * subprocess: exit 0 for a pass/conditional gate, non-zero for a pipeline crash
 * (invalid input, execution exception) or a failed gate.
 */
export function determineExitCode(success: boolean, gateStatus: GateStatus | null): number {
  if (!success) return 1;
  if (gateStatus === "fail") return 1;
  return 0;
}
