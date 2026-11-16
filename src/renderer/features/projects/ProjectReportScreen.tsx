import { useCallback, useMemo, useState } from 'react';
import { EntryTree } from '@/renderer/features/reports/EntryTree';
import { EntryEditor, type Draft } from '@/renderer/features/calendar/EntryEditor';
import { usePresence } from '@/renderer/lib/usePresence';
import { isAgent, isAgentApp, type Activity, TimeEntry } from '@/shared/types';
import { firstStart, fitPeriod, PeriodNav, periodTitle, usePeriod } from '@/renderer/components/PeriodNav';
import { ShareRow, StackedBars, type Bucket } from '@/renderer/components/charts';
import { Segmented } from '@/renderer/components/Segmented';
import { LoButton } from '@/renderer/components/LoButton';
import { AppIcon } from '@/renderer/components/AppIcon';
import { ProjectDot } from '@/renderer/components/ProjectDot';
import { useActivity, useAppIcons, useEntries, useProjects } from '@/renderer/lib/api';
import { appColor } from '@/renderer/lib/colors';
import { duration, money } from '@/renderer/lib/format';
import { earned, entryMs, unionMs } from '@/renderer/lib/stats';
import { HOUR, overlap, startOfDay } from '@/renderer/lib/time';
import { ProjectDialog } from './ProjectsScreen';
import { Icon } from '@/renderer/components/Icon';

const EVER = { from: 0, to: 8_640_000_000_000 };
const appOf = (a: Activity) => a.app;

/** Merges the project's entries into disjoint intervals, clipped to [from, to). */
function intervals(entries: TimeEntry[], from: number, to: number, now: number) {
  const iv = entries
    .map((e) => [Math.max(e.start, from), Math.min(e.end ?? now, to)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** One project over a period: hours, money, what the work was, and what was on screen while the timer said so. */
export function ProjectReportScreen({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const ctl = usePeriod('month');
  const range = { from: ctl.period.from, to: ctl.period.to };
  const projects = useProjects().data ?? [];
  const project = projects.find((p) => p.id === projectId);
  const inPeriod = useEntries(range).data ?? [];
  const ever = useEntries(EVER).data ?? [];
  const activity = useActivity(range).data ?? [];
  const [metric, setMetric] = useState<'hours' | 'earned'>('hours');
  const [app, setApp] = useState<string | null>(null);
  const [claudeBy, setClaudeBy] = useState<'project' | 'session'>('project');
  const [editing, setEditing] = useState(false);
  const now = Date.now();
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const [entryEdit, setEntryEdit] = useState<{ draft: Draft; anchor: DOMRect } | null>(null);
  const [shownEntry, entryClosing] = usePresence(entryEdit);
  const openEntry = (e: TimeEntry, anchor: DOMRect) => setEntryEdit(entryEdit?.draft.id === e.id ? null : { draft: { ...e }, anchor });
  const closeEntry = useCallback(() => setEntryEdit(null), []);

  const entries = useMemo(() => inPeriod.filter((e) => e.projectId === projectId), [inPeriod, projectId]);
  const allTime = useMemo(() => ever.filter((e) => e.projectId === projectId), [ever, projectId]);
  const period = useMemo(() => fitPeriod(ctl.period, firstStart(allTime)), [ctl.period, allTime]);

  const ms = (e: TimeEntry, from = period.from, to = period.to) => entryMs(e, from, to, now);
  const total = entries.reduce((s, e) => s + ms(e), 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + ms(e), 0);
  const income = entries.reduce((s, e) => s + earned(e, project, period.from, period.to), 0);
  const days = new Set(entries.map((e) => startOfDay(e.start))).size;
  const everMs = allTime.reduce((s, e) => s + entryMs(e, -Infinity, Infinity, now), 0);
  const everEarned = allTime.reduce((s, e) => s + earned(e, project), 0);
  const color = project?.color ?? '#8a93a3';
  const rate = project?.rate ?? 0;
  const currency = project?.currency ?? '';

  // Hours (billable vs not) or money per bucket.
  const buckets: Bucket[] = period.buckets.map((b) => {
    const bill = entries.filter((e) => e.billable).reduce((s, e) => s + ms(e, b.from, b.to), 0);
    const rest = entries.filter((e) => !e.billable).reduce((s, e) => s + ms(e, b.from, b.to), 0);
    const segs =
      metric === 'hours'
        ? [
            { key: 'bill', label: 'Billable', color, value: bill },
            { key: 'rest', label: 'Non-billable', color: `color-mix(in srgb, ${color} 35%, white)`, value: rest },
          ]
        : [{ key: 'earned', label: 'Earned', color, value: entries.reduce((s, e) => s + earned(e, project, b.from, b.to), 0) }];
    return { key: String(b.from), label: b.label, title: b.title, segs };
  });

  // What was on screen while this project's time was running: activity clipped to the entries.
  const during = useMemo(() => {
    const iv = intervals(entries, period.from, period.to, now);
    const clipped: { a: Activity; start: number; end: number }[] = [];
    for (const a of activity) {
      for (const [s, e] of iv) {
        if (overlap(a.start, a.end, s, e) > 0) clipped.push({ a, start: Math.max(a.start, s), end: Math.min(a.end, e) });
      }
    }
    const apps = new Map<string, number>();
    for (const c of clipped) apps.set(appOf(c.a), (apps.get(appOf(c.a)) ?? 0) + c.end - c.start);
    const ranked = [...apps.entries()].filter(([, v]) => v >= 30_000).sort((x, y) => y[1] - x[1]);
    const covered = unionMs(
      clipped.filter((c) => c.a.kind === 'app'),
      period.from,
      period.to,
    );
    return { clipped, ranked, covered };
  }, [entries, activity, period, now]);

  const icons = useAppIcons(during.ranked.map(([k]) => k));
  const selected = app && during.ranked.some(([k]) => k === app) ? app : null;

  const details = new Map<string, { label: string; sub: string; ms: number; color: string }>();
  for (const { a, start, end } of during.clipped) {
    if (selected ? appOf(a) !== selected : isAgent(a)) continue;
    const isClaude = isAgent(a);
    const label = isClaude ? (claudeBy === 'project' ? a.context || 'No project' : a.detail || 'Untitled session') : a.detail || (selected ? 'No window title' : a.app);
    const sub = isClaude ? (claudeBy === 'project' ? '' : a.context) : selected ? a.context : a.detail ? a.app : '';
    const k = `${label}\u0000${sub}`;
    const cur = details.get(k) ?? { label, sub, ms: 0, color: appColor(appOf(a)) };
    cur.ms += end - start;
    details.set(k, cur);
  }
  const detailRows = [...details.values()].filter((d) => d.ms >= 30_000).sort((x, y) => y.ms - x.ms).slice(0, 12);


  if (!project) {
    return (
      <div className="page fo-page">
        <div className="page-inner page-inner--wide">
          <div className="lo-card fo-empty">
            <h2 className="lo-h2">This project no longer exists</h2>
            <div>
              <LoButton onClick={onBack}>Back to projects</LoButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page fo-page">
      <div className="page-inner page-inner--wide">
        <div className="fo-pagehead">
          <div>
            <button type="button" className="fo-eyebrow fo-backlink" onClick={onBack}>
              <Icon name="chevron.left" aria-hidden="true" />
              Projects{project.client ? ` · ${project.client}` : ''}
              {project.archived ? ' · Archived' : ''}
            </button>
            <h1 className="fo-headline fo-headline--project">
              <ProjectDot color={color} size={10} />
              {project.name}
            </h1>
          </div>
          <div className="fo-pagehead-actions">
            <PeriodNav ctl={ctl} />
            <LoButton icon="pencil" onClick={() => setEditing(true)}>
              Edit project
            </LoButton>
          </div>
        </div>

        <div className="lo-stats fo-stats">
          <div className="lo-stat" data-first="true">
            <div className="lo-meta">Tracked · {periodTitle(period)}</div>
            <div className="lo-stat-value">{duration(total)}</div>
            <div className="lo-stat-lines">
              <span>{days ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} on ${days} ${days === 1 ? 'day' : 'days'}` : 'Nothing tracked'}</span>
            </div>
          </div>
          <div className="lo-stat">
            <div className="lo-meta">Billable</div>
            <div className="lo-stat-value">{duration(billable)}</div>
            <div className="lo-stat-lines">
              <span>{total ? `${Math.round((billable / total) * 100)}% of tracked time` : '—'}</span>
            </div>
          </div>
          <div className="lo-stat">
            <div className="lo-meta">Earned</div>
            <div className="lo-stat-value">{rate ? money(income, currency) : '—'}</div>
            <div className="lo-stat-lines">
              <span>{rate ? `${money(rate, currency)} per hour` : 'No rate set on this project'}</span>
            </div>
          </div>
          <div className="lo-stat">
            <div className="lo-meta">All time</div>
            <div className="lo-stat-value">{duration(everMs)}</div>
            <div className="lo-stat-lines">
              <span>{everEarned ? `${money(everEarned, currency)} earned` : allTime.length ? `${allTime.length} entries` : 'No time yet'}</span>
            </div>
          </div>
        </div>

        <section className="lo-card fo-card">
          <div className="fo-card-head">
            <h2 className="lo-h2">
              {metric === 'hours' ? 'Hours' : 'Earnings'} by {period.unit}
            </h2>
            {rate > 0 && (
              <Segmented
                label="Chart metric"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: 'hours', label: 'Hours' },
                  { value: 'earned', label: 'Earnings' },
                ]}
              />
            )}
          </div>
          <StackedBars
            buckets={buckets}
            format={metric === 'hours' ? duration : (v) => money(v, currency)}
            axisFormat={metric === 'hours' ? (v) => `${+(v / HOUR).toFixed(1)}h` : (v) => money(v, currency)}
            unit={metric === 'hours' ? (period.kind === 'day' ? 15 * 60_000 : HOUR) : 10}
            height={220}
            emptyLabel={`Nothing tracked on ${project.name} in this period.`}
          />
        </section>

        <div className="fo-grid2 fo-grid2--wide">
          <section className="lo-card fo-card">
            <h2 className="lo-h2">
              Apps while tracking
              {total > 0 && during.covered > 0 && <small>{Math.round((during.covered / total) * 100)}% of the time had computer activity</small>}
            </h2>
            <div className="fo-share-list">
              {during.ranked.length === 0 && <p className="lo-sub">No activity recorded during this project's time entries.</p>}
              {during.ranked.map(([k, v]) => (
                <ShareRow
                  key={k}
                  label={
                    <>
                      <AppIcon name={k} src={icons[k]} />
                      {k}
                      {isAgentApp(k) && <small className="fo-share-note">alongside other apps</small>}
                    </>
                  }
                  value={v}
                  max={during.ranked[0][1]}
                  color={appColor(k)}
                  right={duration(v)}
                  selected={selected === k}
                  onClick={() => setApp(selected === k ? null : k)}
                />
              ))}
            </div>
          </section>
          <section className="lo-card fo-card">
            <div className="fo-card-head">
              <h2 className="lo-h2">{selected ? `In ${selected}` : 'Files, tabs and windows'}</h2>
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
              {detailRows.map((d) => (
                <ShareRow key={d.label + d.sub} label={d.label} sub={d.sub} value={d.ms} max={detailRows[0].ms} color={d.color} right={duration(d.ms)} />
              ))}
            </div>
          </section>
        </div>

        <section className="lo-card fo-card">
          <h2 className="lo-h2">
            What the time went into <small>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</small>
          </h2>
          <EntryTree entries={entries} byId={byId} from={period.from} to={period.to} now={now} byProject={false} onOpen={openEntry} />
        </section>
      </div>

      {shownEntry && (
        <EntryEditor
          key={shownEntry.draft.id}
          draft={shownEntry.draft}
          anchor={shownEntry.anchor}
          projects={projects}
          onClose={closeEntry}
          closing={entryClosing}
        />
      )}
      {editing && (
        <ProjectDialog
          project={project}
          usedColors={projects.map((p) => p.color)}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
