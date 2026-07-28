import type { BaseAward } from "./chapter-config.js";

export const DAILY_SIGN_UP_TASK_GROUP = 20;
export const DAILY_SIGN_UP_TODAY_TASK = 11_001;
export const DAILY_SIGN_UP_TOTAL_TASK = 11_002;

export function makeDailySignUpTaskId(taskId: number): number {
  return (DAILY_SIGN_UP_TASK_GROUP << 16) | taskId;
}

/**
 * NormalActivity/SignUpActivity.txt uses the same cumulative reward sequence
 * for every month. The month only controls how many rows are available.
 */
export const DAILY_SIGN_UP_REWARDS: readonly BaseAward[] = [
  [15, 1, 1, 1, 5_000],
  [10, 1, 1, 2, 1],
  [9, 12, 1, 1, 1],
  [7, 1, 4, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [15, 2, 1, 1, 50],
  [15, 1, 1, 1, 10_000],
  [10, 1, 1, 2, 1],
  [7, 7, 1, 4, 1],
  [7, 3, 1, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [2, 2, 10_000, 1, 1],
  [15, 1, 1, 1, 15_000],
  [10, 1, 1, 2, 1],
  [9, 12, 1, 1, 1],
  [7, 1, 4, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [15, 2, 1, 1, 100],
  [15, 1, 1, 1, 20_000],
  [10, 1, 1, 2, 1],
  [7, 7, 1, 4, 1],
  [7, 3, 1, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [7, 4, 1, 4, 1],
  [15, 1, 1, 1, 25_000],
  [10, 1, 1, 2, 1],
  [9, 12, 1, 1, 1],
];

/**
 * The client considers a day to start at 04:00 in Asia/Shanghai. Shanghai is
 * UTC+8 without daylight saving time, so the operational date is UTC+4.
 */
export function dailySignUpOperationalDate(now = Date.now()): string {
  return new Date(now + 4 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export function daysInOperationalMonth(operationalDate: string): number {
  const [year, month] = operationalDate.split("-").map(Number);
  if (!year || !month) throw new Error(`Invalid operational date: ${operationalDate}`);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dailySignUpReward(
  cumulativeCount: number,
  operationalDate: string,
): BaseAward | null {
  const availableDays = daysInOperationalMonth(operationalDate);
  if (
    !Number.isSafeInteger(cumulativeCount) ||
    cumulativeCount < 0 ||
    cumulativeCount >= availableDays
  ) {
    return null;
  }
  return DAILY_SIGN_UP_REWARDS[cumulativeCount] ?? null;
}
