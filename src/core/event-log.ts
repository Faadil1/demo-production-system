import { writeFile } from "node:fs/promises";
import type { DPSEvent, EventBus, EventHandler } from "./events.js";

export class EventLog implements EventBus {
  private readonly events: DPSEvent[] = [];
  private readonly handlers = new Map<string, Set<EventHandler>>();

  async publish<T>(event: DPSEvent<T>): Promise<void> {
    this.events.push(event);
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        await handler(event);
      }
    }
  }

  subscribe<T>(eventType: string, handler: EventHandler<T>): () => void {
    const set = this.handlers.get(eventType) ?? new Set();
    set.add(handler as EventHandler);
    this.handlers.set(eventType, set);
    return () => set.delete(handler as EventHandler);
  }

  all(): readonly DPSEvent[] {
    return this.events;
  }

  async writeTo(filePath: string): Promise<void> {
    await writeFile(filePath, JSON.stringify(this.events, null, 2), "utf8");
  }
}
