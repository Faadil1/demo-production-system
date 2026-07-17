import type { ISODateTime, RunId } from "./types.js";

export type DPSEvent<T = unknown> = {
  readonly eventId: string;
  readonly runId: RunId;
  readonly type: string;
  readonly occurredAt: ISODateTime;
  readonly source: string;
  readonly payload: T;
};

export type EventHandler<T = unknown> = (
  event: DPSEvent<T>,
) => void | Promise<void>;

export interface EventBus {
  publish<T>(event: DPSEvent<T>): Promise<void>;
  subscribe<T>(eventType: string, handler: EventHandler<T>): () => void;
}
