import type { DecisionId, ISODateTime, RunId } from "./types.js";

export type DecisionOption = {
  readonly id: string;
  readonly label: string;
  readonly tradeoffs?: readonly string[];
};

export type DecisionRecord = {
  readonly decisionId: DecisionId;
  readonly runId: RunId;
  readonly createdAt: ISODateTime;
  readonly engine: string;
  readonly question: string;
  readonly options: readonly DecisionOption[];
  readonly chosenOptionId: string;
  readonly reason: string;
  readonly confidence: number;
  readonly authority: "human" | "engine" | "policy";
  readonly reversible: boolean;
};
