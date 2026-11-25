import { useMemo, useState } from 'react';
import { isAgent, isAgentApp, type Activity } from '@/shared/types';
import { firstStart, fitPeriod, PeriodNav, usePeriod } from '@/renderer/components/PeriodNav';
import { Heatmap, ShareRow, Spark, StackedBars, type Bucket } from '@/renderer/components/charts';
import { Segmented } from '@/renderer/components/Segmented';
import { useActivity, useAppIcons, useMonitorStatus } from '@/renderer/lib/api';
import { AppIcon } from '@/renderer/components/AppIcon';
import { Icon } from '@/renderer/components/Icon';
import { appColor } from '@/renderer/lib/colors';
import { duration, hm } from '@/renderer/lib/format';
import { HOUR, overlap } from '@/renderer/lib/time';
import { unionMs } from '@/renderer/lib/stats';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Clipped length of one activity row inside [from, to). */
const len = (a: Activity, from: number, to: number) => overlap(a.start, a.end, from, to);
/** Under a minute reads "<1m", not "0m". */
const short = (ms: number) => (ms < 60_000 ? '<1m' : duration(ms));
const appOf = (a: Activity) => a.app;

interface DetailRow {
  label: string;
  sub: string;
  ms: number;
  color: string;
  /** A project with several sessions: one row with their total, the sessions inside. */
  sessions?: DetailRow[];
}

/** By session, sessions of the same project fold into one row; a project with a single session stays a plain row. */
function groupSessions(rows: DetailRow[], bySession: boolean): DetailRow[] {
  const byMs = (x: DetailRow, y: DetailRow) => y.ms - x.ms;
  if (!bySession) return rows.sort(byMs);
  const projects = new Map<string, DetailRow[]>();
  for (const r of rows) projects.set(r.sub, [...(projects.get(r.sub) ?? []), r]);
  return [...projects.entries()]
    .map(([project, sessions]): DetailRow =>
      sessions.length === 1
        ? sessions[0]
        : { label: project || 'No project', sub: project, ms: sessions.reduce((s, x) => s + x.ms, 0), color: sessions[0].color, sessions: sessions.sort(byMs) },
    )
    .sort(byMs);
}

/** Adds an interval to a quarter × hour grid (one day), splitting it at quarter-hour boundaries. */
function addToQuarters(grid: number[][], start: number, end: number) {
  let t = start;
  while (t < end) {
    const d = new Date(t);
    const next = new Date(d);
    next.setSeconds(0, 0);
    next.setMinutes(Math.floor(d.getMinutes() / 15) * 15 + 15);
    const stop = Math.min(end, next.getTime());
    grid[Math.floor(d.getMinutes() / 15)][d.getHours()] += stop - t;
    t = stop;
  }
}

/** Adds an interval to a weekday × hour grid, splitting it across hour boundaries. */
function addToGrid(grid: number[][], start: number, end: number) {
  let t = start;
  while (t < end) {
    const d = new Date(t);
    const next = new Date(d);
    next.setMinutes(0, 0, 0);
    next.setHours(d.getHours() + 1);
    const stop = Math.min(end, next.getTime());
    grid[(d.getDay() + 6) % 7][d.getHours()] += stop - t;
    t = stop;
  }
}

export function ActivityScreen() {
  const ctl = usePeriod('week');
  const status = useMonitorStatus().data;
  const q = useActivity({ from: ctl.period.from, to: ctl.period.to });
  const all = useMemo(() => q.data ?? [], [q.data]);
  const period = useMemo(() => fitPeriod(ctl.period, firstStart(all)), [ctl.period, all]);
  const [app, setApp] = useState<string | null>(null);
  const [claudeBy, setClaudeBy] = useState<'project' | 'session'>('project');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  const model = useMemo(() => {
    const { from, to, buckets } = period;
    const apps = new Map<string, { ms: number; perBucket: number[]; kind: Activity['kind'] }>();
    for (const a of all) {
      const k = appOf(a);
      const cur = apps.get(k) ?? { ms: 0, perBucket: buckets.map(() => 0), kind: a.kind };
      cur.ms += len(a, from, to);
      buckets.forEach((b, i) => (cur.perBucket[i] += len(a, b.from, b.to)));
      apps.set(k, cur);
    }
    const ranked = [...apps.entries()].filter(([, v]) => v.ms > 0).sort((x, y) => y[1].ms - x[1].ms);
    return { ranked, apps };
  }, [all, period]);

  const icons = useAppIcons(model.ranked.map(([k]) => k));
  const selected = app && model.apps.has(app) ? app : null;
  const scoped = selected ? all.filter((a) => appOf(a) === selected) : all.filter((a) => a.kind === 'app');
  // Active time is wall-clock: overlapping rows count once.
  const active = unionMs(scoped, period.from, period.to);

  // Heatmap: weekday × hour (a single row for a day view).
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const a of scoped) addToGrid(grid, Math.max(a.start, period.from), Math.min(a.end, period.to));
  // A single day reads better at quarter-hour resolution: four rows (:00 :15 :30 :45) by 24 hours.
  const isDay = period.kind === 'day';
  const quarters = Array.from({ length: 4 }, () => Array(24).fill(0) as number[]);
  if (isDay) for (const a of scoped) addToQuarters(quarters, Math.max(a.start, period.from), Math.min(a.end, period.to));
  const heatRows = isDay ? [':00', ':15', ':30', ':45'] : WEEKDAYS;
  const heatValues = isDay ? quarters : grid;

  // Bars: top apps stacked, the rest folded into "Other".
  const top = model.ranked.filter(([k]) => !isAgentApp(k)).slice(0, 6).map(([k]) => k);
  const buckets: Bucket[] = period.buckets.map((b, i) => {
    if (selected) {
      return { key: String(b.from), label: b.label, title: b.title, segs: [{ key: selected, label: selected, color: appColor(selected), value: model.apps.get(selected)!.perBucket[i] }] };
    }
    const segs = top.map((k) => ({ key: k, label: k, color: appColor(k), value: model.apps.get(k)!.perBucket[i] }));
    const rest = model.ranked.filter(([k]) => !isAgentApp(k) && !top.includes(k)).reduce((s, [, v]) => s + v.perBucket[i], 0);
    if (rest > 0) segs.push({ key: 'other', label: 'Other apps', color: '#c5ccd8', value: rest });
    return { key: String(b.from), label: b.label, title: b.title, segs };
  });

  // Where the time went: details inside the selected app (or across all apps).
  const details = new Map<string, { label: string; sub: string; ms: number; color: string }>();
  for (const a of scoped) {
    const isClaude = isAgent(a);
    const label = isClaude ? (claudeBy === 'project' ? a.context || 'No project' : a.detail || 'Untitled session') : a.detail || (selected ? 'No window title' : a.app);
    const sub = isClaude ? (claudeBy === 'project' ? '' : a.context) : selected ? a.context : a.detail ? a.app : '';
    const k = `${label}\u0000${sub}`;
    const cur = details.get(k) ?? { label, sub, ms: 0, color: appColor(appOf(a)) };
    cur.ms += len(a, period.from, period.to);
    details.set(k, cur);
  }
  const detailRows = groupSessions(
    [...details.values()].filter((d) => d.ms >= 30_000),
    isAgentApp(selected) && claudeBy === 'session',
  ).slice(0, 14);
  const maxApp = model.ranked[0]?.[1].ms ?? 0;
  const maxDetail = detailRows[0]?.ms ?? 0;
  const toggleGroup = (k: string) =>
    setOpenGroups((s) => {
      const n = new Set(s);
      if (!n.delete(k)) n.add(k);
      return n;
    });
  const sparkCount = Math.min(period.buckets.length, period.kind === 'day' ? 24 : period.kind === 'month' ? 31 : 12);

  const empty = !q.isLoading && model.ranked.length === 0;

  return (
    <div className="page fo-page">
      <div className="page-inner page-inner--wide">
        <div className="fo-pagehead">
          <div>
            <h1 className="fo-headline">
              {duration(active)} <span>{selected ? `in ${selected}` : 'active'}</span>
            </h1>
          </div>
          <PeriodNav ctl={ctl} />
        </div>

        {status && !status.enabled && <div className="fo-banner">The activity monitor is off. Turn it on in Settings to record which apps you use.</div>}
        {status && status.enabled && status.native && !status.accessibility && (
          <div className="fo-banner fo-banner--attn">
            Focus can see app names but not window titles. Allow Accessibility access in Settings to see files, tabs and sessions.
          </div>
        )}

        <div className="fo-chips" role="group" aria-label="Filter by app">
          <button type="button" className="fo-chip" aria-pressed={!selected} onClick={() => setApp(null)}>
            All apps
          </button>
          {model.ranked.slice(0, 8).map(([k]) => (
            <button key={k} type="button" className="fo-chip" aria-pressed={selected === k} onClick={() => setApp(selected === k ? null : k)}>
              {icons[k] ? <AppIcon name={k} src={icons[k]} size={18} /> : <span className="fo-chip-dot" style={{ background: appColor(k) }} />}
              {k}
            </button>
          ))}
        </div>

        {empty ? (
          <div className="lo-card fo-empty">
            <h2 className="lo-h2">No activity recorded {period.kind === 'day' ? 'on this day' : 'in this period'}</h2>
            <p className="lo-sub">Focus records the app in front, its window or tab, and your Claude Code and Codex sessions while the monitor is on.</p>
          </div>
        ) : (
          <>
            <div className="fo-grid2">
              <section className="lo-card fo-card">
                <h2 className="lo-h2">{isDay ? 'When you were active' : 'Active time by hour'}</h2>
                <Heatmap
                  rows={heatRows}
                  values={heatValues}
                  height={224}
                  cellTip={isDay ? (q, h) => `${String(h).padStart(2, '0')}:${String(q * 15).padStart(2, '0')}` : undefined}
                  totals={isDay ? heatValues.map(() => '') : heatValues.map((r) => {
                    const t = r.reduce((s, v) => s + v, 0);
                    return !t ? '–' : t >= 100 * HOUR ? duration(t) : hm(t); // all time: "1,132h", not "1131:51"
                  })}
                  format={duration}
                  color={selected ? appColor(selected) : '#3b5bdb'}
                />
              </section>
              <section className="lo-card fo-card">
                <h2 className="lo-h2">{isDay ? 'Apps by hour' : `Active time by ${period.unit}`}</h2>
                <StackedBars buckets={buckets} format={duration} axisFormat={(v) => (period.kind === 'day' ? duration(v) : `${+(v / HOUR).toFixed(1)}h`)} unit={period.kind === 'day' ? 15 * 60_000 : HOUR} height={200} />
              </section>
            </div>

            <div className="fo-grid2 fo-grid2--wide">
              <section className="lo-card fo-card">
                <h2 className="lo-h2">Apps</h2>
                <div className="fo-share-list">
                  {model.ranked.map(([k, v]) => (
                    <ShareRow
                      key={k}
                      label={
                        <>
                          <AppIcon name={k} src={icons[k]} />
                          {k}
                          {isAgentApp(k) && <small className="fo-share-note">alongside other apps</small>}
                        </>
                      }
                      value={v.ms}
                      max={maxApp}
                      color={appColor(k)}
                      right={short(v.ms)}
                      extra={<Spark values={v.perBucket.slice(-sparkCount)} color={appColor(k)} />}
                      selected={selected === k}
                      onClick={() => setApp(selected === k ? null : k)}
                    />
                  ))}
                </div>
              </section>
              <section className="lo-card fo-card">
                <div className="fo-card-head">
                  <h2 className="lo-h2">Where the time went</h2>
                  {isAgentApp(selected) && (
                    <Segmented
                      label="Group sessions by"
                      value={claudeBy}
                      onChange={setClaudeBy}
                      options={[
                        { value: 'project', label: 'Project' },
                        { value: 'session', label: 'Session' },
                      ]}
                    />
                  )}
                </div>
                <div className="fo-share-list">
                  {detailRows.length === 0 && <p className="lo-sub">No window titles recorded for this selection.</p>}
                  {detailRows.map((d) => {
                    if (!d.sessions) return <ShareRow key={d.label + d.sub} label={d.label} sub={d.sub} value={d.ms} max={maxDetail} color={d.color} right={short(d.ms)} />;
                    const open = openGroups.has(d.sub);
                    return (
                      <div key={`group\u0000${d.sub}`} className="fo-share-group">
                        <ShareRow
                          label={
                            <>
                              <Icon name="chevron.right" className="fo-share-chev" aria-hidden="true" />
                              {d.label}
                            </>
                          }
                          sub={`${d.sessions.length} sessions`}
                          value={d.ms}
                          max={maxDetail}
                          color={d.color}
                          right={short(d.ms)}
                          expanded={open}
                          onClick={() => toggleGroup(d.sub)}
                        />
                        {open &&
                          d.sessions.map((s) => (
                            <ShareRow key={s.label} label={s.label} value={s.ms} max={maxDetail} color={s.color} right={short(s.ms)} nested />
                          ))}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
