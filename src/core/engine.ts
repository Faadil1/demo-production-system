import type {
  EngineMetrics,
  ValidationResult,
  VerificationResult,
} from "./types.js";

export type EngineContext = {
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly now: () => Date;
};

export interface Engine<I, O> {
  readonly name: string;
  readonly version: string;

  validate(input: I): ValidationResult;
  run(input: I, context: EngineContext): Promise<O>;
  verify(output: O): VerificationResult;
  metrics(): EngineMetrics;
}
