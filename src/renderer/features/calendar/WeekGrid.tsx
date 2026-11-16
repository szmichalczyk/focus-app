import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { isAgentApp, type Activity, type Project, type TimeEntry } from '@/shared/types';
import { useEntryMutations } from '@/renderer/lib/api';
import { addDays, DAY, MIN, minutesOfDay, sameDay, startOfDay } from '@/renderer/lib/time';
import { duration, time } from '@/renderer/lib/format';
import { appColor, NO_PROJECT } from '@/renderer/lib/colors';
import { entryMs, unionMs } from '@/renderer/lib/stats';
import { activitySessions, HOUR_PX, layoutDay, pxPerMin, SNAP_MIN, type ActivitySession } from './layout';
import { useAppIcons } from '@/renderer/lib/api';
import { AppIcon } from '@/renderer/components/AppIcon';

/** mix: entries + a narrow activity strip · time: entries only · activity: activity only, full width and labelled. */
export type CalendarMode = 'mix' | 'time' | 'activity';
import type { Draft } from './EntryEditor';

type Drag =
  | { kind: 'create'; day: number; a: number; b: number }
  | { kind: 'move'; entry: TimeEntry; grabMin: number; grabDay: number; dayIdx: number; startMin: number; moved: boolean; rect: DOMRect }
  | { kind: 'resize'; entry: TimeEntry; endMin: number; moved: boolean };

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const clampMin = (min: number) => Math.max(0, Math.min(24 * 60, min));

export function WeekGrid({
  weekStart,
  entries,
  activity,
  projects,
  mode,
  now,
  scrollToHour,
  onOpenEntry,
  onOpenActivity,
}: {
  weekStart: number;
  entries: TimeEntry[];
  activity: Activity[];
  projects: Project[];
  mode: CalendarMode;
  now: number;
  scrollToHour: number;
  onOpenEntry: (d: Draft, anchor: DOMRect | null) => void;
  onOpenActivity: (s: ActivitySession, anchor: DOMRect) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const m = useEntryMutations();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // Open on the working day (Settings → "Week view starts at").
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, scrollToHour * HOUR_PX - 8);
  }, [weekStart, scrollToHour]);

  /** Day index and minute-of-day under the pointer. */
  function locate(e: { clientX: number; clientY: number }) {
    const body = bodyRef.current!;
    const cols = [...body.querySelectorAll<HTMLElement>('[data-day-col]')];
    let idx = cols.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right;
    });
    if (idx < 0) idx = e.clientX < cols[0].getBoundingClientRect().left ? 0 : 6;
    const top = body.getBoundingClientRect().top;
    return { idx, min: clampMin((e.clientY - top) / pxPerMin) };
  }

  // Auto-scroll while dragging near the top/bottom edge.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const step = () => {
      const el = scrollRef.current;
      const p = pointer.current;
      if (el && p) {
        const r = el.getBoundingClientRect();
        if (p.y < r.top + 32) el.scrollTop -= 10;
        else if (p.y > r.bottom - 32) el.scrollTop += 10;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [!!drag]); // eslint-disable-line react-hooks/exhaustive-deps

  function onLaneDown(e: RPointerEvent, dayIdx: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { min } = locate(e);
    const a = Math.floor(min / SNAP_MIN) * SNAP_MIN;
    setDrag({ kind: 'create', day: dayIdx, a, b: a + SNAP_MIN });
  }

  /** Press feedback: the tile sinks a touch while held, and a faint ripple spreads from the pointer. */
  function pressFeedback(tile: HTMLElement, x: number, y: number) {
    tile.dataset.pressed = 'true';
    const release = () => {
      delete tile.dataset.pressed;
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = document.createElement('span');
    r.className = 'fo-ripple';
    const size = Math.max(tile.offsetWidth, tile.offsetHeight) * 2;
    r.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px`;
    r.addEventListener('animationend', () => r.remove());
    tile.appendChild(r);
  }

  function onEntryDown(e: RPointerEvent, entry: TimeEntry, dayIdx: number, resize: boolean) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (entry.id === '__draft') return; // the block being described in the editor
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const tile = (e.currentTarget as HTMLElement).closest('.fo-entry') as HTMLElement;
    const rect = tile.getBoundingClientRect();
    if (!resize) pressFeedback(tile, e.clientX - rect.left, e.clientY - rect.top);
    if (resize && entry.end !== null) {
      setDrag({ kind: 'resize', entry, endMin: minutesOfDay(entry.end) || 24 * 60, moved: false });
      return;
    }
    const { min } = locate(e);
    setDrag({ kind: 'move', entry, grabMin: min, grabDay: dayIdx, dayIdx, startMin: minutesOfDay(entry.start), moved: false, rect });
  }

  function onMove(e: RPointerEvent) {
    pointer.current = { x: e.clientX, y: e.clientY };
    const d = dragRef.current;
    if (!d) return;
    const { idx, min } = locate(e);
    if (d.kind === 'create') {
      setDrag({ ...d, b: snap(min) });
    } else if (d.kind === 'move') {
      if (d.entry.end === null) return; // a running entry stays where it started
      const delta = snap(min - d.grabMin);
      const startMin = snap(minutesOfDay(d.entry.start)) + delta;
      const moved = d.moved || Math.abs(min - d.grabMin) > 4 || idx !== d.grabDay;
      setDrag({ ...d, dayIdx: idx, startMin, moved });
    } else {
      const start = minutesOfDay(d.entry.start);
      const sameDayStart = startOfDay(d.entry.start) === startOfDay(d.entry.end!) || minutesOfDay(d.entry.end!) === 0;
      const endMin = Math.max(sameDayStart ? start + SNAP_MIN : SNAP_MIN, snap(min));
      setDrag({ ...d, endMin, moved: true });
    }
  }

  function onUp(e: RPointerEvent) {
    const d = dragRef.current;
    setDrag(null);
    pointer.current = null;
    if (!d) return;
    if (d.kind === 'create') {
      const [lo, hi] = d.a <= d.b ? [d.a, Math.max(d.b, d.a + SNAP_MIN)] : [d.b, d.a];
      // A plain click (no drag) makes a 30-minute block; a drag makes exactly what was drawn.
      const len = hi - lo <= SNAP_MIN && Math.abs(d.b - d.a) <= SNAP_MIN ? 30 : hi - lo;
      const start = days[d.day] + lo * MIN;
      // Anchor the editor to the block that was drawn.
      const col = bodyRef.current!.querySelector<HTMLElement>(`[data-day-col="${d.day}"]`)!.getBoundingClientRect();
      const top = bodyRef.current!.getBoundingClientRect().top + lo * pxPerMin;
      onOpenEntry(
        { projectId: null, description: '', start, end: start + len * MIN, billable: false, source: 'calendar' },
        new DOMRect(col.left, top, col.width, len * pxPerMin),
      );
    } else if (d.kind === 'move') {
      if (!d.moved) {
        onOpenEntry({ ...d.entry }, d.rect);
        return;
      }
      const start = days[d.dayIdx] + d.startMin * MIN;
      const len = d.entry.end! - d.entry.start;
      if (start !== d.entry.start) m.update.mutate({ id: d.entry.id, patch: { start, end: start + len } });
    } else if (d.moved) {
      const end = startOfDay(d.entry.end! - 1) + d.endMin * MIN;
      if (end > d.entry.start && end !== d.entry.end) m.update.mutate({ id: d.entry.id, patch: { end } });
    }
  }

  // Entries as they should render, with the drag preview applied.
  const shown = entries.map((e) => {
    if (drag?.kind === 'move' && drag.entry.id === e.id && drag.moved) {
      const start = days[drag.dayIdx] + drag.startMin * MIN;
      return { ...e, start, end: start + (e.end! - e.start) };
    }
    if (drag?.kind === 'resize' && drag.entry.id === e.id) return { ...e, end: startOfDay(e.end! - 1) + drag.endMin * MIN };
    return e;
  });

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const showActivity = mode !== 'time';
  const full = mode === 'activity';
  const icons = useAppIcons(full ? [...new Set(activity.map((a) => a.app))] : []);

  return (
    <div className="fo-cal" data-mode={mode}>
      <div className="fo-cal-head">
        <div className="fo-cal-gutter" />
        {days.map((d) => {
          const total = shown.filter((e) => e.id !== '__draft').reduce((s, e) => s + entryMs(e, d, d + DAY, now), 0);
          const active = showActivity ? unionMs(activity.filter((a) => a.kind === 'app'), d, d + DAY) : 0;
          const today = sameDay(d, now);
          return (
            <div key={d} className="fo-dayhead" data-today={today}>
              <span className="fo-dayhead-name">{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="fo-dayhead-num">{new Date(d).getDate()}</span>
              {/* One number, one line: tracked time (or, on the Activity tab, time at the computer). */}
              <span className="fo-dayhead-total" title={full ? 'Active on the computer' : 'Tracked'}>
                {full ? (active ? duration(active) : '') : total ? duration(total) : ''}
              </span>
            </div>
          );
        })}
      </div>

      <div className="fo-cal-scroll" ref={scrollRef}>
        <div
          className="fo-cal-body"
          ref={bodyRef}
          style={{ height: 24 * HOUR_PX }}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
        >
          <div className="fo-cal-gutter">
            {hours.map((h) =>
              h === 0 ? null : (
                <span key={h} className="fo-hour" style={{ top: h * HOUR_PX }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              ),
            )}
          </div>

          {days.map((day, di) => {
            const segs = layoutDay(shown, day, now);
            const sessions = showActivity ? activitySessions(activity, day) : [];
            const today = sameDay(day, now);
            return (
              <div key={day} className="fo-day" data-day-col={di} data-today={today}>
                {!full && (
                <div className="fo-lane fo-lane--entries" onPointerDown={(e) => onLaneDown(e, di)}>
                  {segs.map((s) => {
                    const p = s.entry.projectId ? byId.get(s.entry.projectId) : undefined;
                    const color = p?.color ?? NO_PROJECT;
                    const top = minutesOfDay(s.start) * pxPerMin + 1;
                    const height = Math.max(14, ((s.end - s.start) / MIN) * pxPerMin - 3);
                    const live = s.entry.end === null;
                    // Lifted (shadow) only once it really moves, so a plain click doesn't flash a shadow.
                    const dragging = drag && drag.kind !== 'create' && drag.moved && drag.entry.id === s.entry.id;
                    return (
                      <div
                        key={`${s.entry.id}-${day}`}
                        className="fo-entry"
                        data-live={live}
                        data-dragging={!!dragging}
                        data-short={height < 34}
                        style={{
                          top,
                          height,
                          left: `calc(${(s.col / s.cols) * 100}% + 2px)`,
                          width: `calc(${100 / s.cols}% - 4px)`,
                          ['--c' as string]: color,
                          borderTopLeftRadius: s.clippedTop ? 3 : undefined,
                          borderTopRightRadius: s.clippedTop ? 3 : undefined,
                          borderBottomLeftRadius: s.clippedBottom ? 3 : undefined,
                          borderBottomRightRadius: s.clippedBottom ? 3 : undefined,
                        }}
                        title={`${s.entry.description || 'No description'}${p ? ` · ${p.name}` : ''}\n${time(s.entry.start)} – ${live ? 'now' : time(s.entry.end!)}`}
                        onPointerDown={(e) => onEntryDown(e, s.entry, di, false)}
                      >
                        <span className="fo-entry-title">{s.entry.description || p?.name || 'No description'}</span>
                        {/* Each line only when the tile can hold it whole: title 18 + pill 18 + len 18, 4px gaps, 6px padding. */}
                        {height >= 52 && s.entry.description && p && (
                          <span className="fo-entry-pillwrap">
                            <span className="fo-entry-pill">{p.name}</span>
                          </span>
                        )}
                        {height >= 76 && <span className="fo-entry-len">{duration((s.entry.end ?? now) - s.entry.start)}</span>}
                        {s.entry.billable && <span className="fo-entry-bill" aria-label="Billable">$</span>}
                        {!live && !s.clippedBottom && (
                          <span className="fo-entry-resize" onPointerDown={(e) => onEntryDown(e, s.entry, di, true)} aria-hidden="true" />
                        )}
                      </div>
                    );
                  })}
                  {drag?.kind === 'create' && drag.day === di && (
                    <div
                      className="fo-ghost"
                      style={{
                        top: Math.min(drag.a, drag.b) * pxPerMin,
                        height: Math.max(SNAP_MIN, Math.abs(drag.b - drag.a)) * pxPerMin,
                      }}
                    >
                      {time(day + Math.min(drag.a, drag.b) * MIN)} – {time(day + Math.max(drag.b, drag.a + SNAP_MIN) * MIN)}
                    </div>
                  )}
                </div>
                )}

                {showActivity && (
                  <div className="fo-lane fo-lane--activity" aria-label="Activity">
                    {sessions.map((s) => (
                      <SessionTile key={s.key} session={s} onOpen={onOpenActivity} full={full} icons={icons} />
                    ))}
                  </div>
                )}

                {today && <div className="fo-now" style={{ top: minutesOfDay(now) * pxPerMin }} aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One session at the computer. Mix: a quiet bar beside the entries. Activity: a full tile with the apps used. */
function SessionTile({
  session,
  onOpen,
  full,
  icons,
}: {
  session: ActivitySession;
  onOpen: (s: ActivitySession, r: DOMRect) => void;
  full: boolean;
  icons: Record<string, string | null>;
}) {
  const top = minutesOfDay(session.start) * pxPerMin + 1;
  const height = Math.max(6, ((session.end - session.start) / MIN) * pxPerMin - 2);
  // Agent sessions run alongside whatever app is in front, so they name the tile only when nothing else ran.
  const lead = session.apps.find((a) => !isAgentApp(a.name)) ?? session.apps[0];
  const others = session.apps.filter((a) => a !== lead);
  const color = appColor(lead?.name ?? '');
  const len = duration(session.activeMs);
  const names = session.apps.slice(0, 3).map((a) => a.name).join(', ');
  // Rows of app chips that fit under the pill and the number.
  const chipRows = Math.max(0, Math.floor((height - 64) / 24));
  return (
    <button
      type="button"
      className="fo-sess"
      data-full={full}
      data-size={height < 26 ? 's' : height < 52 ? 'm' : 'l'}
      style={{ top, height, ['--c' as string]: color }}
      title={`${time(session.start)} – ${time(session.end)} · ${len} active\n${names}${session.apps.length > 3 ? ` +${session.apps.length - 3}` : ''}`}
      onClick={(e) => onOpen(session, e.currentTarget.getBoundingClientRect())}
    >
      {full && height >= 18 && (
        <>
          <span className="fo-sess-head">
            <span className="fo-sess-pill">
              <AppIcon name={lead.name} src={icons[lead.name]} size={14} />
              {lead.name}
              {session.apps.length > 1 && <em>+{session.apps.length - 1}</em>}
            </span>
            {height < 52 && <small>{len}</small>}
          </span>
          {height >= 52 && <b className="fo-sess-len">{len}</b>}
          {chipRows > 0 && session.apps.length > 1 && (
            <span className="fo-sess-chips">
              {others.slice(0, chipRows * 2).map((a) => (
                <span key={a.name}>
                  <AppIcon name={a.name} src={icons[a.name]} size={12} />
                  {a.name}
                </span>
              ))}
            </span>
          )}
        </>
      )}
    </button>
  );
}
