/**
 * 打卡统计。**纯函数**——规则要不要改，只动这里。
 *
 * 现在的规则（2026-04 定）：
 * - 一个自然日只要有 ≥1 条记录就算打卡；日期用"照片拍摄时间"，没有就退回记录时间；
 * - 日期一律按**本机时区的自然日**（跨设备时区差异留到同步阶段再统一）；
 * - 连续天数：最后打卡日是今天或昨天才算"没断"（**今天还没打卡不算断**——今天还没过完）；
 * - 只统计与展示，**不做清零、不删任何数据**。"清零 / 轮次"是 PRD §12 第 16 条，另行设计。
 */

export type ChallengeStats = {
  /** 有打卡的自然日（升序去重） */
  days: string[];
  checked: number;
  /** 当前连续天数；已断则为 0 */
  streak: number;
  /** 历史最长连续 */
  longest: number;
  /** 已中断：最后打卡日既不是今天也不是昨天 */
  broken: boolean;
  lastDay: string | null;
  checkedToday: boolean;
};

/** "YYYY-MM-DD" → 从 1970-01-01 起的天数（用 UTC 算，避开夏令时与闰月） */
export function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** "今天" / "昨天" / "N 天前" */
export function relativeDay(day: string, today: string): string {
  const gap = daysBetween(day, today);
  if (gap <= 0) return "今天";
  if (gap === 1) return "昨天";
  if (gap < 30) return `${gap} 天前`;
  return `${Math.floor(gap / 30)} 个月前`;
}

export function computeChallenge(days: Iterable<string>, today: string): ChallengeStats {
  // "YYYY-MM-DD" 的字典序就是时间序，可以直接 sort
  const sorted = [...new Set(days)].filter(Boolean).sort();
  if (sorted.length === 0) {
    return { days: [], checked: 0, streak: 0, longest: 0, broken: false, lastDay: null, checkedToday: false };
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    run = daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const lastDay = sorted[sorted.length - 1];
  const alive = daysBetween(lastDay, today) <= 1;

  const set = new Set(sorted);
  let streak = 0;
  if (alive) {
    let cursor = lastDay;
    while (set.has(cursor)) {
      streak += 1;
      cursor = shiftDay(cursor, -1);
    }
  }

  return {
    days: sorted,
    checked: sorted.length,
    streak,
    longest,
    broken: !alive,
    lastDay,
    checkedToday: set.has(today),
  };
}
