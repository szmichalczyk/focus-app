import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { app } from 'electron';
import type {
  Activity,
  ActivityKind,
  EntryInput,
  EntryPatch,
  Project,
  ProjectInput,
  ProjectPatch,
  Range,
  Settings,
  TimeEntry,
} from '../shared/types';

let sqlite: Database.Database | undefined;

/** Ordered schema steps. Append only; never edit a shipped step. */
const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     client TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL,
     rate REAL NOT NULL DEFAULT 0,
     currency TEXT NOT NULL,
     billable_default INTEGER NOT NULL DEFAULT 1,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE entries (
     id TEXT PRIMARY KEY,
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
     description TEXT NOT NULL DEFAULT '',
     start INTEGER NOT NULL,
     end INTEGER,
     billable INTEGER NOT NULL DEFAULT 1,
     source TEXT NOT NULL DEFAULT 'manual'
   );
   CREATE INDEX entries_start ON entries(start);
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     app TEXT NOT NULL,
     bundle_id TEXT NOT NULL DEFAULT '',
     detail TEXT NOT NULL DEFAULT '',
     context TEXT NOT NULL DEFAULT '',
     url TEXT NOT NULL DEFAULT '',
     start INTEGER NOT NULL,
     end INTEGER NOT NULL
   );
   CREATE INDEX activity_range ON activity(start, end);
   CREATE TABLE claude_files (
     path TEXT PRIMARY KEY,
     offset INTEGER NOT NULL,
     mtime INTEGER NOT NULL
   );
   CREATE TABLE claude_sessions (
     session_id TEXT PRIMARY KEY,
     project TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     last_ts INTEGER NOT NULL,
     activity_id INTEGER
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // Sessions started by other programs through the Agent SDK (e.g. LeaderOS's own Claude calls) are not your work:
  // remember which sessions are automated and re-read the logs so the existing ones drop out.
  `ALTER TABLE claude_sessions ADD COLUMN automated INTEGER NOT NULL DEFAULT 0;
   DELETE FROM activity WHERE kind = 'claude';
   DELETE FROM claude_files;
   DELETE FROM claude_sessions;`,
  // The first-run welcome: an install that already has data has seen the app, so it skips it.
  `INSERT OR IGNORE INTO settings (key, value)
     SELECT 'onboarded', 'true'
     WHERE EXISTS (SELECT 1 FROM projects) OR EXISTS (SELECT 1 FROM entries) OR EXISTS (SELECT 1 FROM activity);`,
  // Claude app project threads were titled "</wake>" and filed under the folder, and a tool's own "sessionId"
  // argument could pass for a session: re-read the Claude Code logs (Codex state is left alone).
  `DELETE FROM activity WHERE kind = 'claude';
   DELETE FROM claude_files WHERE path LIKE '%/.claude/projects/%';
   DELETE FROM claude_sessions WHERE session_id NOT LIKE 'codex:%';`,
];

export function initDb() {
  if (sqlite) return sqlite;
  sqlite = new Database(path.join(app.getPath('userData'), 'focus.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const version = sqlite.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    sqlite.transaction(() => {
      sqlite!.exec(MIGRATIONS[i]);
      sqlite!.pragma(`user_version = ${i + 1}`);
    })();
  }
  return sqlite;
}

export function db() {
  if (!sqlite) throw new Error('Database not initialised');
  return sqlite;
}

// ── Projects ─────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  client: string;
  color: string;
  rate: number;
  currency: string;
  billable_default: number;
  archived: number;
  created_at: number;
}
const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  client: r.client,
  color: r.color,
  rate: r.rate,
  currency: r.currency,
  billableByDefault: !!r.billable_default,
  archived: !!r.archived,
  createdAt: r.created_at,
});

export const projects = {
  list(): Project[] {
    return (db().prepare('SELECT * FROM projects ORDER BY archived, created_at').all() as ProjectRow[]).map(toProject);
  },
  get(id: string): Project {
    const row = db().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!row) throw new Error('Project not found');
    return toProject(row);
  },
  create(input: ProjectInput): Project {
    const id = randomUUID();
    db()
      .prepare(
        `INSERT INTO projects (id, name, client, color, rate, currency, billable_default, archived, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.client.trim(),
        input.color,
        Math.max(0, input.rate),
        input.currency,
        input.billableByDefault ? 1 : 0,
        input.archived ? 1 : 0,
        Date.now(),
      );
    return projects.get(id);
  },
  update(id: string, patch: ProjectPatch): Project {
    const p = { ...projects.get(id), ...patch };
    db()
      .prepare(
        `UPDATE projects SET name = ?, client = ?, color = ?, rate = ?, currency = ?, billable_default = ?, archived = ?
         WHERE id = ?`,
      )
      .run(p.name.trim(), p.client.trim(), p.color, Math.max(0, p.rate), p.currency, p.billableByDefault ? 1 : 0, p.archived ? 1 : 0, id);
    return projects.get(id);
  },
  remove(id: string) {
    db().prepare('DELETE FROM projects WHERE id = ?').run(id);
  },
};

// ── Time entries ─────────────────────────────────────────────────────────

interface EntryRow {
  id: string;
  project_id: string | null;
  description: string;
  start: number;
  end: number | null;
  billable: number;
  source: TimeEntry['source'];
}
const toEntry = (r: EntryRow): TimeEntry => ({
  id: r.id,
  projectId: r.project_id,
  description: r.description,
  start: r.start,
  end: r.end,
  billable: !!r.billable,
  source: r.source,
});

function checkTimes(start: number, end: number | null) {
  if (!Number.isFinite(start)) throw new Error('Start time is missing');
  if (end !== null && end <= start) throw new Error('End must be after start');
}

export const entries = {
  list({ from, to }: Range): TimeEntry[] {
    return (
      db()
        .prepare('SELECT * FROM entries WHERE start < ? AND (end IS NULL OR end > ?) ORDER BY start')
        .all(to, from) as EntryRow[]
    ).map(toEntry);
  },
  get(id: string): TimeEntry {
    const row = db().prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined;
    if (!row) throw new Error('Entry not found');
    return toEntry(row);
  },
  create(input: EntryInput): TimeEntry {
    checkTimes(input.start, input.end);
    const id = randomUUID();
    db()
      .prepare('INSERT INTO entries (id, project_id, description, start, end, billable, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.projectId, input.description.trim(), input.start, input.end, input.billable ? 1 : 0, input.source);
    return entries.get(id);
  },
  update(id: string, patch: EntryPatch): TimeEntry {
    const e = { ...entries.get(id), ...patch };
    checkTimes(e.start, e.end);
    db()
      .prepare('UPDATE entries SET project_id = ?, description = ?, start = ?, end = ?, billable = ?, source = ? WHERE id = ?')
      .run(e.projectId, e.description.trim(), e.start, e.end, e.billable ? 1 : 0, e.source, id);
    return entries.get(id);
  },
  remove(id: string) {
    db().prepare('DELETE FROM entries WHERE id = ?').run(id);
  },
  running(): TimeEntry | null {
    const row = db().prepare('SELECT * FROM entries WHERE end IS NULL ORDER BY start DESC LIMIT 1').get() as
      | EntryRow
      | undefined;
    return row ? toEntry(row) : null;
  },
  /** Ends every running entry at `at`; entries shorter than a minute are dropped as accidental. */
  stopAll(at: number): TimeEntry | null {
    const running = entries.running();
    if (!running) return null;
    db().prepare('UPDATE entries SET end = ? WHERE end IS NULL').run(Math.max(at, running.start + 1000));
    db().prepare('DELETE FROM entries WHERE end IS NOT NULL AND end - start < 60000 AND source = ?').run('timer');
    try {
      return entries.get(running.id);
    } catch {
      return null;
    }
  },
};

// ── Activity ─────────────────────────────────────────────────────────────

interface ActivityRow {
  id: number;
  kind: ActivityKind;
  app: string;
  bundle_id: string;
  detail: string;
  context: string;
  url: string;
  start: number;
  end: number;
}
const toActivity = (r: ActivityRow): Activity => ({
  id: r.id,
  kind: r.kind,
  app: r.app,
  bundleId: r.bundle_id,
  detail: r.detail,
  context: r.context,
  url: r.url,
  start: r.start,
  end: r.end,
});

export const activity = {
  list({ from, to }: Range): Activity[] {
    return (
      db().prepare("SELECT * FROM activity WHERE start < ? AND end > ? AND app != 'Focus' ORDER BY start").all(to, from) as ActivityRow[]
    ).map(toActivity);
  },
  insert(a: Omit<Activity, 'id'>): number {
    const r = db()
      .prepare(
        'INSERT INTO activity (kind, app, bundle_id, detail, context, url, start, end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(a.kind, a.app, a.bundleId, a.detail, a.context, a.url, a.start, a.end);
    return Number(r.lastInsertRowid);
  },
  setEnd(id: number, end: number) {
    db().prepare('UPDATE activity SET end = ? WHERE id = ?').run(end, id);
  },
  setDetail(id: number, detail: string) {
    db().prepare('UPDATE activity SET detail = ? WHERE id = ?').run(detail, id);
  },
  clear() {
    db().exec('DELETE FROM activity; DELETE FROM claude_files; DELETE FROM claude_sessions;');
  },
};

// ── Settings ─────────────────────────────────────────────────────────────

function defaultCurrency() {
  const cc = app.getLocaleCountryCode?.() || '';
  if (cc === 'PL') return 'PLN';
  if (cc === 'GB') return 'GBP';
  if (cc === 'CH') return 'CHF';
  if (['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR', 'SK', 'SI', 'LT', 'LV', 'EE', 'HR'].includes(cc))
    return 'EUR';
  return 'USD';
}

const DEFAULTS = (): Settings => ({
  currency: defaultCurrency(),
  monitorEnabled: true,
  idleMinutes: 3,
  browserTabs: true,
  claudeSessions: true,
  codexSessions: true,
  dayStartHour: 8,
  onboarded: false,
});

export const settings = {
  get(): Settings {
    const rows = db().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out = DEFAULTS() as unknown as Record<string, unknown>;
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore a corrupt value; the default stands */
      }
    }
    return out as unknown as Settings;
  },
  save(patch: Partial<Settings>): Settings {
    const stmt = db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    db().transaction(() => {
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) stmt.run(k, JSON.stringify(v));
    })();
    return settings.get();
  },
};
