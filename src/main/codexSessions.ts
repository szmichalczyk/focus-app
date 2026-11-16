import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_APPS } from '../shared/types';
import { activity, db, settings } from './db';

/**
 * Reads Codex session logs (~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread id>.jsonl) into the activity stream, the
 * same way Claude Code sessions are read: events less than GAP apart form one run of work, and files are read
 * incrementally from a remembered byte offset. Session state shares the claude_sessions/claude_files tables
 * (ids prefixed "codex:"), so "Clear activity" and the offsets work for both.
 */

const HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const ROOT = path.join(HOME, 'sessions');
const INDEX = path.join(HOME, 'session_index.jsonl');
const GAP_MS = 10 * 60_000;
const TAIL_MS = 60_000;
const BACKFILL_DAYS = 90;
const SCAN_MS = 60_000;
const APP = AGENT_APPS.codex;

/** Lines that mean Codex or you did something (UI settings changes and bookkeeping lines don't). */
const WORK_EVENTS = new Set(['task_started', 'task_complete', 'user_message', 'agent_message', 'item_completed']);

interface SessionState {
  /** Reviewers, subagents and `codex exec` runs: started by a program, not by you. Never recorded. */
  automated: boolean;
  project: string;
  title: string;
  lastTs: number;
  activityId: number | null;
}

let scanning = false;
let timer: NodeJS.Timeout | undefined;

const key = (id: string) => `codex:${id}`;

function loadSession(id: string): SessionState | null {
  const r = db()
    .prepare('SELECT automated, project, title, last_ts AS lastTs, activity_id AS activityId FROM claude_sessions WHERE session_id = ?')
    .get(key(id)) as (Omit<SessionState, 'automated'> & { automated: number }) | undefined;
  return r ? { ...r, automated: !!r.automated } : null;
}
function saveSession(id: string, s: SessionState) {
  db()
    .prepare(
      `INSERT INTO claude_sessions (session_id, automated, project, title, last_ts, activity_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET automated = excluded.automated, project = excluded.project, title = excluded.title,
         last_ts = excluded.last_ts, activity_id = excluded.activity_id`,
    )
    .run(key(id), s.automated ? 1 : 0, s.project, s.title, s.lastTs, s.activityId);
}

const cleanTitle = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 90);

/** Thread names Codex gives sessions (and you rename them to), newest line wins. */
function readIndex(): Map<string, string> {
  const names = new Map<string, string>();
  let text = '';
  try {
    text = fs.readFileSync(INDEX, 'utf8');
  } catch {
    return names;
  }
  for (const l of text.split('\n')) {
    if (!l) continue;
    try {
      const j = JSON.parse(l) as { id?: string; thread_name?: string };
      if (j.id && j.thread_name) names.set(j.id, cleanTitle(j.thread_name));
    } catch {
      /* skip a partial line */
    }
  }
  return names;
}

/** What you typed, without the context Codex wraps around it. */
function promptText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  for (const c of content as { type?: string; text?: string }[]) {
    if (c?.type !== 'input_text' || !c.text) continue;
    let t = c.text.trim();
    if (t.startsWith('<')) continue; // environment, permissions and other injected context
    const ask = t.indexOf('## My request for Codex:');
    if (ask >= 0) t = t.slice(ask + 24);
    else if (t.startsWith('#')) continue;
    t = cleanTitle(t);
    if (t) return t;
  }
  return '';
}

function setTitle(s: SessionState, title: string) {
  if (!title || title === s.title) return;
  // Earlier runs of the session carry the old title: rename them too.
  if (s.title) db().prepare("UPDATE activity SET detail = ? WHERE kind = 'codex' AND detail = ? AND context = ?").run(title, s.title, s.project);
  s.title = title;
  if (s.activityId) activity.setDetail(s.activityId, title);
}

/** Applies one log line of session `sid`. Returns true if the activity stream changed. */
function applyLine(line: string, sid: string, sessions: Map<string, SessionState>, names: Map<string, string>): boolean {
  if (line.length < 40) return false;
  const head = line.slice(0, 240);
  const type = head.match(/"type":"([a-z_]+)"/)?.[1];
  if (type === 'session_meta') {
    try {
      const p = (JSON.parse(line) as { payload?: Record<string, unknown> }).payload ?? {};
      const src = p.source;
      const automated =
        !!p.parent_thread_id ||
        (typeof src === 'object' && src !== null) ||
        src === 'exec' ||
        (typeof p.thread_source === 'string' && p.thread_source !== 'user');
      const cwd = typeof p.cwd === 'string' ? p.cwd : '';
      const prev = sessions.get(sid) ?? loadSession(sid);
      sessions.set(sid, prev ?? { automated, project: cwd ? path.basename(cwd) : APP, title: names.get(sid) ?? '', lastTs: 0, activityId: null });
    } catch {
      /* unreadable meta: the session stays unknown and is skipped */
    }
    return false;
  }
  if (type !== 'response_item' && type !== 'event_msg') return false;
  const s = sessions.get(sid) ?? loadSession(sid);
  if (!s || s.automated) return false;
  sessions.set(sid, s);
  const inner = line.slice(0, 400).match(/"payload":\{"type":"([a-z_]+)"/)?.[1] ?? '';
  if (type === 'event_msg' && !WORK_EVENTS.has(inner)) return false;

  if (!s.title && type === 'response_item' && inner === 'message' && line.includes('"role":"user"') && line.length < 200_000) {
    try {
      setTitle(s, promptText((JSON.parse(line) as { payload?: { content?: unknown } }).payload?.content));
    } catch {
      /* keep going without a title */
    }
  }

  const ts = Date.parse(head.match(/"timestamp":"([^"]+)"/)?.[1] ?? '');
  if (!Number.isFinite(ts) || ts <= s.lastTs) return false;
  if (s.activityId && ts - s.lastTs <= GAP_MS) {
    activity.setEnd(s.activityId, ts + TAIL_MS);
  } else {
    s.activityId = activity.insert({ kind: 'codex', app: APP, bundleId: '', detail: s.title, context: s.project, url: '', start: ts, end: ts + TAIL_MS });
  }
  s.lastTs = ts;
  return true;
}

async function readFrom(file: string, sid: string, offset: number, size: number, sessions: Map<string, SessionState>, names: Map<string, string>) {
  let changed = false;
  let consumed = offset;
  let carry = '';
  const stream = fs.createReadStream(file, { start: offset, end: size - 1, encoding: 'utf8', highWaterMark: 1 << 20 });
  for await (const chunk of stream as AsyncIterable<string>) {
    const lines = (carry + chunk).split('\n');
    carry = lines.pop() ?? '';
    db().transaction(() => {
      for (const l of lines) {
        consumed += Buffer.byteLength(l, 'utf8') + 1;
        if (applyLine(l, sid, sessions, names)) changed = true;
      }
    })();
  }
  // An unterminated last line is still being written: leave it for the next scan.
  return { changed, offset: consumed };
}

/** Every rollout file under sessions/, newest folders included. */
async function rolloutFiles(dir: string, out: string[] = []): Promise<string[]> {
  let items: fs.Dirent[];
  try {
    items = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of items) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await rolloutFiles(p, out);
    else if (d.name.startsWith('rollout-') && d.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

export async function scanCodex(): Promise<boolean> {
  const cfg = settings.get();
  if (scanning || !cfg.codexSessions || !cfg.onboarded || !fs.existsSync(ROOT)) return false;
  scanning = true;
  let changed = false;
  try {
    const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
    const names = readIndex();
    const known = new Map(
      (db().prepare('SELECT path, offset, mtime FROM claude_files').all() as { path: string; offset: number; mtime: number }[]).map(
        (r) => [r.path, r],
      ),
    );
    const upsert = db().prepare(
      'INSERT INTO claude_files (path, offset, mtime) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, mtime = excluded.mtime',
    );
    const sessions = new Map<string, SessionState>();
    for (const file of await rolloutFiles(ROOT)) {
      // The thread id ends the file name: rollout-<date>-<uuid>.jsonl.
      const sid = path.basename(file, '.jsonl').slice(-36);
      const st = await fs.promises.stat(file).catch(() => null);
      if (!st) continue;
      const prev = known.get(file);
      if (prev && prev.mtime === st.mtimeMs && prev.offset >= st.size) continue;
      if (!prev && st.mtimeMs < cutoff) {
        upsert.run(file, st.size, st.mtimeMs);
        continue;
      }
      const from = prev && prev.offset <= st.size ? prev.offset : 0;
      if (from >= st.size) {
        upsert.run(file, from, st.mtimeMs);
        continue;
      }
      try {
        const r = await readFrom(file, sid, from, st.size, sessions, names);
        upsert.run(file, r.offset, st.mtimeMs);
        if (r.changed) changed = true;
      } catch (err) {
        console.warn('[codex] skipped', file, err);
      }
    }
    // Codex names a thread a moment after it starts, and you can rename it: follow the index.
    const recorded = db().prepare("SELECT session_id AS id FROM claude_sessions WHERE session_id LIKE 'codex:%' AND automated = 0").all() as { id: string }[];
    db().transaction(() => {
      for (const { id: k } of recorded) {
        const id = k.slice(6);
        const name = names.get(id);
        if (!name) continue;
        const s = sessions.get(id) ?? loadSession(id);
        if (!s || s.title === name) continue;
        setTitle(s, name);
        sessions.set(id, s);
        changed = true;
      }
      for (const [id, s] of sessions) saveSession(id, s);
    })();
  } finally {
    scanning = false;
  }
  return changed;
}

export function startCodexWatcher(changed: () => void) {
  const run = () =>
    void scanCodex()
      .then((c) => c && changed())
      .catch((e) => console.error('[codex] scan failed', e));
  run();
  timer = setInterval(run, SCAN_MS);
}

export function stopCodexWatcher() {
  if (timer) clearInterval(timer);
}
