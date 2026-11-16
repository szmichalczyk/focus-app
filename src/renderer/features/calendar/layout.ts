import { isAgent, isAgentApp, type Activity, type TimeEntry } from '@/shared/types';
import { DAY, MIN, overlap } from '@/renderer/lib/time';

export const HOUR_PX = 52;
export const SNAP_MIN = 15;
export const pxPerMin = HOUR_PX / 60;

export interface EntrySeg {
  entry: TimeEntry;
  start: number;
  end: number;
  col: number;
  cols: number;
  /** The entry continues from the previous day / into the next. */
  clippedTop: boolean;
  clippedBottom: boolean;
}

/** Splits entries into one segment per day and lays overlapping segments side by side. */
export function layoutDay(entries: TimeEntry[], day: number, now: number): EntrySeg[] {
  const dayEnd = day + DAY;
  const segs = entries
    .map((e) => {
      const end = e.end ?? now;
      if (overlap(e.start, end, day, dayEnd) <= 0) return null;
      return {
        entry: e,
        start: Math.max(e.start, day),
        end: Math.min(end, dayEnd),
        col: 0,
        cols: 1,
        clippedTop: e.start < day,
        clippedBottom: end > dayEnd,
      } as EntrySeg;
    })
    .filter((s): s is EntrySeg => !!s)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // Greedy columns inside clusters of mutually overlapping segments.
  let cluster: EntrySeg[] = [];
  let clusterEnd = -Infinity;
  const colEnds: number[] = [];
  const flush = () => {
    const n = Math.max(1, ...cluster.map((s) => s.col + 1));
    cluster.forEach((s) => (s.cols = n));
    cluster = [];
    colEnds.length = 0;
  };
  for (const s of segs) {
    if (s.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let c = colEnds.findIndex((end) => end <= s.start);
    if (c < 0) c = colEnds.length;
    colEnds[c] = s.end;
    s.col = c;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();
  return segs;
}

export interface SessionApp {
  name: string;
  ms: number;
  /** Windows, files, tabs or agent sessions inside this app, longest first. */
  details: { label: string; sub: string; ms: number }[];
}

/** One stretch of being at the computer: everything you did until a break longer than the gap. */
export interface ActivitySession {
  key: string;
  start: number;
  end: number;
  /** Wall-clock time something was recorded (breaks under the gap excluded). */
  activeMs: number;
  apps: SessionApp[];
}

const appName = (a: Activity) => a.app;

/**
 * Merges all activity of a day (apps and agent sessions) into one stream of sessions: a new session starts only
 * after a break longer than `gapMs`. Sessions shorter than `minMs` of activity are dropped as noise.
 */
export function activitySessions(items: Activity[], day: number, gapMs = 5 * MIN, minMs = 3 * MIN): ActivitySession[] {
  const dayEnd = day + DAY;
  const rows = items
    .map((a) => ({ a, start: Math.max(a.start, day), end: Math.min(a.end, dayEnd) }))
    .filter((r) => r.end > r.start)
    .sort((x, y) => x.start - y.start);
  const groups: { start: number; end: number; rows: typeof rows }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && r.start - last.end <= gapMs) {
      last.end = Math.max(last.end, r.end);
      last.rows.push(r);
    } else groups.push({ start: r.start, end: r.end, rows: [r] });
  }
  return groups
    .map((g) => {
      // Active time is the union of the rows: overlapping app runs and agent sessions count once.
      let active = 0;
      let cur: [number, number] | null = null;
      for (const r of g.rows) {
        if (!cur || r.start > cur[1]) {
          if (cur) active += cur[1] - cur[0];
          cur = [r.start, r.end];
        } else cur[1] = Math.max(cur[1], r.end);
      }
      if (cur) active += cur[1] - cur[0];

      const apps = new Map<string, { ms: number; details: Map<string, { label: string; sub: string; ms: number }> }>();
      for (const { a, start, end } of g.rows) {
        const name = appName(a);
        const app = apps.get(name) ?? { ms: 0, details: new Map() };
        app.ms += end - start;
        const label = isAgent(a) ? a.detail || 'Untitled session' : a.detail || '';
        const sub = isAgent(a) ? a.context : a.app === name ? a.context : a.app;
        if (label) {
          const k = `${label}\u0000${sub}`;
          const d = app.details.get(k) ?? { label, sub, ms: 0 };
          d.ms += end - start;
          app.details.set(k, d);
        }
        apps.set(name, app);
      }
      return {
        key: `${g.start}`,
        start: g.start,
        end: g.end,
        activeMs: active,
        apps: [...apps.entries()]
          .map(([name, v]) => ({ name, ms: v.ms, details: [...v.details.values()].sort((x, y) => y.ms - x.ms) }))
          .sort((x, y) => y.ms - x.ms),
      };
    })
    .filter((s) => s.activeMs >= minMs);
}

/** The best one-line description of a session, for logging it as a time entry. */
export function sessionLabel(s: ActivitySession) {
  const agent = s.apps.find((a) => isAgentApp(a.name))?.details[0];
  const top = s.apps.find((a) => !isAgentApp(a.name) && a.details[0]);
  return agent?.sub || top?.details[0]?.label || s.apps[0]?.name || 'Activity';
}
