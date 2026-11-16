import type { Activity, Project, TimeEntry } from '@/shared/types';
import { overlap } from './time';

/** All aggregation for reports lives here, so screens only lay numbers out. */

export const entryEnd = (e: TimeEntry, now = Date.now()) => e.end ?? now;

export function entryMs(e: TimeEntry, from = -Infinity, to = Infinity, now = Date.now()) {
  return overlap(e.start, entryEnd(e, now), from, to);
}

export function earned(e: TimeEntry, project: Project | undefined, from?: number, to?: number) {
  if (!e.billable || !project || !project.rate) return 0;
  return (entryMs(e, from, to) / 3_600_000) * project.rate;
}

/** Sums by currency: a PLN project and a EUR project never add up into one number. */
export function earningsByCurrency(entries: TimeEntry[], byId: Map<string, Project>, from?: number, to?: number) {
  const out = new Map<string, number>();
  for (const e of entries) {
    const p = e.projectId ? byId.get(e.projectId) : undefined;
    const v = earned(e, p, from, to);
    if (v > 0 && p) out.set(p.currency, (out.get(p.currency) ?? 0) + v);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Activity rows can overlap (an app run and an agent session at the same time). "Active time" counts wall-clock
 * once: the union of the intervals, clipped to [from, to).
 */
export function unionMs(items: { start: number; end: number }[], from: number, to: number) {
  const iv = items
    .map((a) => [Math.max(a.start, from), Math.min(a.end, to)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of iv) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

/** Window-sampled app activity only; agent sessions run in parallel to whatever app is in front. */
export const appRuns = (a: Activity[]) => a.filter((x) => x.kind === 'app');

export function groupSum<T>(items: T[], key: (t: T) => string, ms: (t: T) => number) {
  const m = new Map<string, number>();
  for (const it of items) {
    const v = ms(it);
    if (v > 0) m.set(key(it), (m.get(key(it)) ?? 0) + v);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
