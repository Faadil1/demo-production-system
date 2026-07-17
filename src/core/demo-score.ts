export type DemoScoreDeduction = {
  readonly reason: string;
  readonly points: number;
};

export type DemoScoreCategory = {
  readonly id: string;
  readonly label: string;
  readonly maximumPoints: number;
  readonly awardedPoints: number;
  readonly rationale: string;
  readonly supportingObservationIds: readonly string[];
  readonly deductions: readonly DemoScoreDeduction[];
};

export type DemoScoreGrade = "excellent" | "strong" | "adequate" | "weak" | "insufficient";

export type DemoScore = {
  readonly total: number;
  readonly maximum: 100;
  readonly grade: DemoScoreGrade;
  readonly categories: readonly DemoScoreCategory[];
};

export function gradeForTotal(total: number): DemoScoreGrade {
  if (total >= 90) return "excellent";
  if (total >= 75) return "strong";
  if (total >= 60) return "adequate";
  if (total >= 40) return "weak";
  return "insufficient";
}

export function clampScore(value: number, maximum: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}
