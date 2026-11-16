import { BrowserWindow, ipcMain } from 'electron';
import { Channels, type ChangeScope, type TimerStartInput } from '../shared/ipc';
import type { EntryInput, EntryPatch, ProjectInput, ProjectPatch, Range, Settings } from '../shared/types';
import { activity, entries, projects, settings } from './db';
import { monitorStatus, requestAccessibility, startMonitor, stopMonitor } from './monitor';
import { claudeLastScan, scanClaude } from './claudeSessions';
import { scanCodex } from './codexSessions';
import { appIcons } from './appIcons';

export function broadcast(scope: ChangeScope) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(Channels.changed, scope);
}

export function startTimer(input: TimerStartInput) {
  const now = Date.now();
  entries.stopAll(now);
  const e = entries.create({ ...input, start: now, end: null, source: 'timer' });
  broadcast('entries');
  return e;
}

export function stopTimer() {
  const e = entries.stopAll(Date.now());
  broadcast('entries');
  return e;
}

export function registerHandlers(onTimerChange: () => void) {
  const h = <A extends unknown[], R>(ch: string, fn: (...a: A) => R) =>
    ipcMain.handle(ch, (_e, ...a) => fn(...(a as A)));

  h(Channels.projectList, () => projects.list());
  h(Channels.projectCreate, (i: ProjectInput) => projects.create(i));
  h(Channels.projectUpdate, (id: string, p: ProjectPatch) => projects.update(id, p));
  h(Channels.projectDelete, (id: string) => projects.remove(id));

  h(Channels.entryList, (r: Range) => entries.list(r));
  h(Channels.entryCreate, (i: EntryInput) => {
    const e = entries.create(i);
    if (e.end === null) onTimerChange();
    return e;
  });
  h(Channels.entryUpdate, (id: string, p: EntryPatch) => {
    const e = entries.update(id, p);
    onTimerChange();
    return e;
  });
  h(Channels.entryDelete, (id: string) => {
    entries.remove(id);
    onTimerChange();
  });
  h(Channels.entryRunning, () => entries.running());
  h(Channels.timerStart, (i: TimerStartInput) => {
    const e = startTimer(i);
    onTimerChange();
    return e;
  });
  h(Channels.timerStop, () => {
    const e = stopTimer();
    onTimerChange();
    return e;
  });

  h(Channels.activityList, (r: Range) => activity.list(r));
  h(Channels.activityClear, () => activity.clear());
  h(Channels.appIcons, (names: string[]) => appIcons(names));
  h(Channels.monitorStatus, () => ({ ...monitorStatus(), claudeLastScan: claudeLastScan() }));
  h(Channels.monitorRequestAccess, () => requestAccessibility());

  h(Channels.settingsGet, () => settings.get());
  h(Channels.settingsSave, (p: Partial<Settings>) => {
    const before = settings.get();
    const next = settings.save(p);
    if (before.monitorEnabled !== next.monitorEnabled) {
      if (next.monitorEnabled) startMonitor(() => broadcast('activity'));
      else stopMonitor();
    }
    if ((!before.claudeSessions || !before.onboarded) && next.claudeSessions && next.onboarded) void scanClaude().then((c) => c && broadcast('activity'));
    if ((!before.codexSessions || !before.onboarded) && next.codexSessions && next.onboarded) void scanCodex().then((c) => c && broadcast('activity'));
    return next;
  });
}
