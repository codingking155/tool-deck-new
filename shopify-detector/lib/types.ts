import type { DetectionResult } from "./detect";

export type { DetectionResult };
export type CheckResult = DetectionResult & { cached: boolean };

export interface ApiError {
  error: string;
  message: string;
  reason?: string;
  retry_after?: number;
}

export type SpeedLabel = "Fast" | "Average" | "Slow";

export function speedLabel(ms: number): SpeedLabel {
  if (ms < 1000) return "Fast";
  if (ms < 3000) return "Average";
  return "Slow";
}
