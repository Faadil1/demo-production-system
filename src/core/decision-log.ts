import { writeFile } from "node:fs/promises";
import type { DecisionRecord } from "./decision.js";

export class DecisionLog {
  private readonly records: DecisionRecord[] = [];

  record(decision: DecisionRecord): void {
    this.records.push(decision);
  }

  recordAll(decisions: readonly DecisionRecord[]): void {
    for (const decision of decisions) {
      this.record(decision);
    }
  }

  all(): readonly DecisionRecord[] {
    return this.records;
  }

  async writeTo(filePath: string): Promise<void> {
    await writeFile(filePath, JSON.stringify(this.records, null, 2), "utf8");
  }
}
