import type { FocusApi, ChangeScope } from '@/shared/ipc';
import type { Activity, Project, Settings, TimeEntry } from '@/shared/types';
import { addDays, atMinutes, startOfDay, startOfWeek } from './time';

/**
 * In-memory stand-in for the Electron bridge, so the renderer runs in a plain browser (design work, screenshots).
 * Seeds three years of plausible client work and activity. Inside the app only in demo mode (`npm run demo`).
 */
export function createDemoApi(): FocusApi {
  const listeners = new Set<(s: ChangeScope) => void>();
  const emit = (s: ChangeScope) => listeners.forEach((l) => l(s));
  const uid = () => Math.random().toString(36).slice(2, 10);

  const projects: Project[] = [
    { id: 'p1', name: 'Northwind', client: 'Northwind Traders', color: '#d9488a', rate: 140, currency: 'USD', billableByDefault: true, archived: false, createdAt: 1 },
    { id: 'p2', name: 'Halcyon app', client: 'Halcyon Health', color: '#3b7ddd', rate: 125, currency: 'USD', billableByDefault: true, archived: false, createdAt: 2 },
    { id: 'p3', name: 'Atlas UI kit', client: 'Atlas', color: '#2f9e8f', rate: 150, currency: 'USD', billableByDefault: true, archived: false, createdAt: 3 },
    { id: 'p4', name: 'Orbit deck', client: 'Orbit Labs', color: '#e08a2c', rate: 110, currency: 'USD', billableByDefault: true, archived: false, createdAt: 4 },
    { id: 'p5', name: 'Studio admin', client: '', color: '#6c56d9', rate: 0, currency: 'USD', billableByDefault: false, archived: false, createdAt: 5 },
    // Earlier clients, finished and archived: they fill the All time view.
    { id: 'p6', name: 'Lumen website', client: 'Lumen', color: '#4aa3c7', rate: 95, currency: 'USD', billableByDefault: true, archived: true, createdAt: 0 },
    { id: 'p7', name: 'Pine banking', client: 'Pine Bank', color: '#5a8f3c', rate: 115, currency: 'USD', billableByDefault: true, archived: true, createdAt: 0 },
  ];
  const entries: TimeEntry[] = [];
  const activity: Activity[] = [];
  let settings: Settings = { currency: 'USD', monitorEnabled: true, idleMinutes: 3, browserTabs: true, claudeSessions: true, codexSessions: true, dayStartHour: 8, onboarded: true };

  // What each project's work looks like: tasks, the apps (and windows) they happen in, and Claude Code sessions.
  type Win = [app: string, detail: string, context: string, url: string];
  type Task = { label: string; weight: number; apps: Win[]; claude?: [title: string, folder: string] };
  const T: Record<string, Task[]> = {
    p1: [
      { label: 'Logo exploration', weight: 3, apps: [['Figma', 'Northwind — Logo v4', '', ''], ['Figma', 'Northwind — Moodboard', '', ''], ['Arc', 'Brand New — Logo reviews', 'underconsideration.com', 'https://www.underconsideration.com/brandnew/']] },
      { label: 'Brand guidelines', weight: 2, apps: [['Figma', 'Northwind — Guidelines', '', ''], ['Notion', 'Northwind · Voice and tone', '', '']] },
      { label: 'Website hero', weight: 2, apps: [['Figma', 'Northwind — Website', '', ''], ['Framer', 'northwind.co — Home', '', ''], ['Arc', 'Northwind — Staging', 'northwind.framer.website', 'https://northwind.framer.website']] },
      { label: 'Client review call', weight: 1, apps: [['Zoom', 'Northwind weekly', '', ''], ['Figma', 'Northwind — Logo v4', '', '']] },
    ],
    p2: [
      { label: 'Onboarding flow', weight: 3, apps: [['Figma', 'Halcyon — Onboarding', '', ''], ['Figma', 'Halcyon — Prototype', '', ''], ['Linear', 'HAL-212 Onboarding copy', '', '']] },
      { label: 'Settings screen', weight: 3, apps: [['Cursor', 'SettingsScreen.tsx', 'halcyon-app', ''], ['Simulator', 'iPhone 17 Pro', '', ''], ['Arc', 'React Native docs', 'reactnative.dev', 'https://reactnative.dev/docs']], claude: ['Settings screen with sections', 'halcyon-app'] },
      { label: 'Push notifications fix', weight: 2, apps: [['Xcode', 'NotificationService.swift', 'Halcyon', ''], ['Cursor', 'notifications.ts', 'halcyon-app', ''], ['Arc', 'Apple Developer — APNs', 'developer.apple.com', 'https://developer.apple.com']], claude: ['Debug silent push on iOS', 'halcyon-app'] },
      { label: 'Sprint planning', weight: 1, apps: [['Linear', 'Halcyon · Sprint 14', '', ''], ['Zoom', 'Halcyon planning', '', '']] },
    ],
    p3: [
      { label: 'Button and input tokens', weight: 3, apps: [['Figma', 'Atlas — Components', '', ''], ['Figma', 'Atlas — Tokens', '', '']] },
      { label: 'Docs site', weight: 2, apps: [['Cursor', 'button.mdx', 'atlas-docs', ''], ['Arc', 'Atlas Docs — Button', 'localhost:3000', 'http://localhost:3000/button']], claude: ['Generate token tables for docs', 'atlas-docs'] },
      { label: 'Component audit', weight: 1, apps: [['Notion', 'Atlas · Component audit', '', ''], ['Figma', 'Atlas — Audit', '', '']] },
    ],
    p4: [
      { label: 'Narrative outline', weight: 2, apps: [['Notion', 'Orbit · Pitch narrative', '', ''], ['Arc', 'Orbit Labs', 'orbitlabs.io', 'https://orbitlabs.io']] },
      { label: 'Seed deck slides', weight: 3, apps: [['Keynote', 'Orbit Seed Deck', '', ''], ['Figma', 'Orbit — Charts', '', '']] },
      { label: 'Market sizing', weight: 1, apps: [['Arc', 'Crunchbase — Climate analytics', 'crunchbase.com', 'https://www.crunchbase.com'], ['Numbers', 'Orbit TAM', '', '']] },
    ],
    p5: [
      { label: 'Invoices and bookkeeping', weight: 2, apps: [['Arc', 'Stripe — Invoices', 'dashboard.stripe.com', 'https://dashboard.stripe.com/invoices'], ['Numbers', 'Studio 2026', '', '']] },
      { label: 'Inbox', weight: 3, apps: [['Mail', 'Inbox', '', ''], ['Slack', 'studio-general', '', '']] },
      { label: 'Portfolio case study', weight: 1, apps: [['Framer', 'Portfolio — Halcyon case study', '', ''], ['Figma', 'Portfolio shots', '', '']] },
    ],
    p6: [
      { label: 'Homepage design', weight: 3, apps: [['Figma', 'Lumen — Homepage', '', ''], ['Arc', 'Lumen staging', 'lumen.webflow.io', 'https://lumen.webflow.io']] },
      { label: 'Webflow build', weight: 2, apps: [['Arc', 'Webflow — Lumen', 'webflow.com', 'https://webflow.com'], ['Figma', 'Lumen — Components', '', '']] },
    ],
    p7: [
      { label: 'Account overview screens', weight: 3, apps: [['Figma', 'Pine — Accounts', '', ''], ['Figma', 'Pine — Prototype', '', '']] },
      { label: 'Usability testing', weight: 1, apps: [['Zoom', 'Pine research session', '', ''], ['Notion', 'Pine · Test notes', '', '']] },
      { label: 'Design QA', weight: 2, apps: [['Arc', 'Pine TestFlight notes', 'pine.atlassian.net', 'https://pine.atlassian.net'], ['Figma', 'Pine — Accounts', '', '']] },
    ],
  };
  const chatter: Win[] = [
    ['Slack', 'northwind-design', '', ''],
    ['Slack', 'halcyon-dev', '', ''],
    ['Mail', 'Inbox', '', ''],
    ['Messages', '', '', ''],
    ['Arc', 'Home / X', 'x.com', 'https://x.com/home'],
    ['Linear', 'My issues', '', ''],
  ];
  /** Who the studio worked for, and when: [project, weight, from weeks ago, until weeks ago]. */
  const eras: [string, number, number, number][] = [
    ['p6', 5, 156, 92],
    ['p7', 5, 118, 48],
    ['p3', 3, 70, 0],
    ['p2', 5, 56, 0],
    ['p1', 4, 22, 0],
    ['p4', 2, 9, 0],
    ['p5', 1.5, 156, 0],
  ];
  const weightsAt = (weeksAgo: number) => eras.filter(([, , a, b]) => weeksAgo <= a && weeksAgo >= b).map(([id, w]) => [id, w] as [string, number]);

  // A fixed seed: the same screenshots every time.
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <X,>(xs: X[]) => xs[Math.floor(rnd() * xs.length)];
  const pickW = <X,>(xs: [X, number][]) => {
    let r = rnd() * xs.reduce((s, [, w]) => s + w, 0);
    for (const [x, w] of xs) if ((r -= w) <= 0) return x;
    return xs[xs.length - 1][0];
  };
  const M = 60_000;
  const now = Date.now();
  const push = (a: Omit<Activity, 'id'>) => {
    const end = Math.min(a.end, now);
    if (end - a.start >= M) activity.push({ ...a, end, id: activity.length + 1 });
  };
  /** App activity across [from, to): mostly the task's own windows, now and then a glance at chat. */
  const fill = (from: number, to: number, wins: Win[]) => {
    let t = from;
    while (t < to && t < now) {
      const len = (3 + Math.floor(rnd() * 18)) * M;
      const [app, detail, context, url] = rnd() < 0.78 ? pick(wins) : pick(chatter);
      push({ kind: 'app', app, bundleId: '', detail, context, url, start: t, end: Math.min(t + len, to) });
      const r = rnd();
      t += len + (r < 0.1 ? (1 + Math.floor(rnd() * 3)) * M : r < 0.2 ? (7 + Math.floor(rnd() * 8)) * M : 0); // short pauses, and now and then a real break
    }
  };

  // Three years of weekdays, with a couple of holidays a year.
  const WEEKS = 156;
  const week0 = addDays(startOfWeek(now), -WEEKS * 7);
  const holiday = new Set(Array.from({ length: WEEKS }, (_, w) => w).filter(() => rnd() < 0.05));
  for (let d = 0; d < (WEEKS + 1) * 7; d++) {
    const day = addDays(week0, d);
    const dow = (new Date(day).getDay() + 6) % 7;
    const weeksAgo = WEEKS - Math.floor(d / 7);
    if (dow > 4 || day > now || (weeksAgo > 0 && holiday.has(weeksAgo)) || rnd() < 0.05) continue;
    const weights = weightsAt(weeksAgo);
    let m = 9 * 60 + Math.floor(rnd() * 3) * 15; // 9:00–9:30
    fill(atMinutes(day, m - 20), atMinutes(day, m), chatter); // morning email before the first entry
    // Today is scripted, so a screenshot always has a full morning and a timer that has been running a while.
    const isToday = day === startOfDay(now);
    const script: [string, number, number][] = [['p2', 1, 90], ['p1', 0, 90], ['p3', 1, 90], ['p5', 1, 30], ['p2', 0, 120]];
    let step = 0;
    if (isToday) m = 9 * 60;
    let prev = '';
    let lunch = false;
    while (m < 18 * 60) {
      if (!lunch && m >= 12 * 60 + 15) {
        lunch = true;
        m += 45;
        continue;
      }
      const scripted = isToday ? script[step++] : undefined;
      let projectId = scripted?.[0] ?? pickW(weights);
      if (!scripted && projectId === prev) projectId = pickW(weights);
      prev = projectId;
      const p = projects.find((x) => x.id === projectId)!;
      const task = scripted ? T[projectId][scripted[1]] : pickW(T[projectId].map((t) => [t, t.weight] as [Task, number]));
      const len = scripted?.[2] ?? pick([45, 60, 75, 90, 90, 105, 120, 150]);
      const start = atMinutes(day, m);
      const end = atMinutes(day, Math.min(m + len, 18 * 60 + 30));
      if (start >= now) break;
      const running = end > now;
      entries.push({ id: uid(), projectId, description: task.label, start, end: running ? null : end, billable: p.billableByDefault, source: running ? 'timer' : 'calendar' });
      fill(start, end, task.apps);
      if (task.claude) {
        const cs = start + Math.floor(rnd() * 15) * M;
        const ce = Math.min(cs + (25 + Math.floor(rnd() * 40)) * M, end);
        // Some of the agent work happens in Codex (picked from the start time, so the rest of the demo stays the same).
        const codex = Math.floor(cs / M) % 3 === 0;
        push({ kind: codex ? 'codex' : 'claude', app: codex ? 'Codex' : 'Claude Code', bundleId: codex ? '' : 'claude-desktop', detail: task.claude[0], context: task.claude[1], url: '', start: cs, end: ce });
      }
      if (running) break;
      const gap = isToday ? (step === 1 ? 15 : 0) : pick([0, 0, 15, 15, 30]);
      if (gap) fill(end, atMinutes(day, m + len + gap), chatter); // untracked time between entries
      m += len + gap;
    }
  }

  // `?fresh` in the browser preview: a brand-new install (no data, welcome not done, no Accessibility yet).
  const fresh = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fresh');
  let accessibility = !fresh;
  if (fresh) {
    projects.length = 0;
    entries.length = 0;
    activity.length = 0;
    settings = { ...settings, onboarded: false };
  }

  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const ok = <T,>(x: T) => Promise.resolve(clone(x));

  return {
    projects: {
      list: () => ok(projects),
      create: (i) => {
        const p: Project = { ...i, id: uid(), archived: !!i.archived, createdAt: Date.now() };
        projects.push(p);
        emit('projects');
        return ok(p);
      },
      update: (id, patch) => {
        const p = projects.find((x) => x.id === id)!;
        Object.assign(p, patch);
        emit('projects');
        return ok(p);
      },
      remove: (id) => {
        projects.splice(projects.findIndex((x) => x.id === id), 1);
        entries.forEach((e) => e.projectId === id && (e.projectId = null));
        emit('projects');
        return ok(undefined);
      },
    },
    entries: {
      list: ({ from, to }) => ok(entries.filter((e) => e.start < to && (e.end ?? Date.now()) > from).sort((a, b) => a.start - b.start)),
      create: (i) => {
        if (i.end !== null && i.end <= i.start) return Promise.reject(new Error('End must be after start'));
        const e = { ...i, id: uid() };
        entries.push(e);
        emit('entries');
        return ok(e);
      },
      update: (id, patch) => {
        const e = entries.find((x) => x.id === id)!;
        const next = { ...e, ...patch };
        if (next.end !== null && next.end <= next.start) return Promise.reject(new Error('End must be after start'));
        Object.assign(e, patch);
        emit('entries');
        return ok(e);
      },
      remove: (id) => {
        entries.splice(entries.findIndex((x) => x.id === id), 1);
        emit('entries');
        return ok(undefined);
      },
      running: () => ok(entries.find((e) => e.end === null) ?? null),
    },
    timer: {
      start: (i) => {
        entries.forEach((e) => e.end === null && (e.end = Date.now()));
        const e: TimeEntry = { ...i, id: uid(), start: Date.now(), end: null, source: 'timer' };
        entries.push(e);
        emit('entries');
        return ok(e);
      },
      stop: () => {
        const e = entries.find((x) => x.end === null) ?? null;
        if (e) e.end = Date.now();
        emit('entries');
        return ok(e);
      },
    },
    activity: {
      list: ({ from, to }) => ok(activity.filter((a) => a.start < to && a.end > from)),
      clear: () => {
        activity.length = 0;
        emit('activity');
        return ok(undefined);
      },
    },
    apps: {
      icons: (names) => ok(Object.fromEntries(names.map((n) => [n, null]))),
    },
    monitor: {
      status: () =>
        ok({
          enabled: settings.monitorEnabled,
          accessibility,
          idle: false,
          current: fresh ? null : { app: 'Figma', detail: 'Halcyon — Onboarding', since: now - 12 * 60_000 },
          claudeLastScan: fresh ? null : now,
          native: false,
        }),
      requestAccess: () => {
        accessibility = true;
        return ok(true);
      },
    },
    settings: {
      get: () => ok(settings),
      save: (p) => {
        settings = { ...settings, ...p };
        return ok(settings);
      },
    },
    onChanged: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
