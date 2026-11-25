import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activity, db, settings } from './db';

/**
 * Reads Claude Code session logs (~/.claude/projects/<project>/<session>.jsonl) into the activity stream.
 * Each session becomes runs of work: messages less than GAP apart belong to one run. Files are read
 * incrementally (byte offset per file), so a scan only parses what was appended since the last one.
 */

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const GAP_MS = 10 * 60_000;
/** A run's end gets this much after its last message, the reading/thinking time after a reply. */
const TAIL_MS = 60_000;
const BACKFILL_DAYS = 90;
const SCAN_MS = 60_000;

interface SessionState {
  /** Started by a program, not typed by you: every turn came from the SDK. Never recorded. */
  automated: boolean;
  project: string;
  title: string;
  lastTs: number;
  activityId: number | null;
}

let lastScan: number | null = null;
let scanning = false;
let timer: NodeJS.Timeout | undefined;

export const claudeLastScan = () => lastScan;

function loadSession(id: string): SessionState | null {
  const r = db()
    .prepare('SELECT automated, project, title, last_ts AS lastTs, activity_id AS activityId FROM claude_sessions WHERE session_id = ?')
    .get(id) as (Omit<SessionState, 'automated'> & { automated: number }) | undefined;
  return r ? { ...r, automated: !!r.automated } : null;
}
function saveSession(id: string, s: SessionState) {
  db()
    .prepare(
      `INSERT INTO claude_sessions (session_id, automated, project, title, last_ts, activity_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET automated = excluded.automated, project = excluded.project, title = excluded.title,
         last_ts = excluded.last_ts, activity_id = excluded.activity_id`,
    )
    .run(id, s.automated ? 1 : 0, s.project, s.title, s.lastTs, s.activityId);
}

const field = (line: string, name: string) => {
  const m = line.match(new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? m[1] : '';
};

function firstText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content) if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') return String((c as { text?: string }).text ?? '');
  }
  return '';
}

const cleanTitle = (s: string) =>
  s
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/**
 * A prompt's title. In Claude app projects every prompt arrives wrapped in
 * <wake><project><thread><message from="human">…</message></thread></project></wake>: the title is what you wrote.
 */
function promptTitle(text: string): string {
  if (!text.includes('<wake')) return cleanTitle(text);
  const m = text.match(/<message\b[^>]*\bfrom="human"[^>]*>([\s\S]*?)<\/message>/);
  if (!m) return '';
  return cleanTitle(decode(m[1].replace(/<attachment\b[^>]*>(?:\s*<\/attachment>)?/g, ' ').replace(/<[^>]+>/g, ' ')));
}

/** Claude app projects: the project's own name only appears in the context each of its threads is given. */
const PROJECT_NAME = /Project: \\"((?:[^"\\]|\\.){1,120}?)\\" \(id: `chan_/;

/** Project names found before the session's first message (the context comes first). */
const pendingProjects = new Map<string, string>();

function setProject(sid: string, name: string, sessions: Map<string, SessionState>) {
  const s = sessions.get(sid) ?? loadSession(sid);
  if (!s) {
    pendingProjects.set(sid, name);
    return;
  }
  if (s.project === name) return;
  if (s.activityId) db().prepare("UPDATE activity SET context = ? WHERE id = ? AND kind = 'claude'").run(name, s.activityId);
  s.project = name;
  sessions.set(sid, s);
}

interface LogLine {
  type?: string;
  isSidechain?: boolean;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  turnOrigin?: string;
  entrypoint?: string;
  message?: { content?: unknown };
}

/** Applies one log line. Returns true if the activity stream changed. */
function applyLine(line: string, sessions: Map<string, SessionState>): boolean {
  if (line.length < 20) return false;
  // Titles: written by Claude Code as their own lines.
  if (line.includes('"type":"custom-title"') || line.includes('"type":"ai-title"') || line.includes('"type":"summary"')) {
    const sid = field(line, 'sessionId');
    const title = field(line, 'customTitle') || field(line, 'aiTitle') || field(line, 'title') || field(line, 'summary');
    const s = sid ? sessions.get(sid) ?? loadSession(sid) : null;
    if (s && title) {
      s.title = cleanTitle(JSON.parse(`"${title}"`));
      sessions.set(sid, s);
      if (s.activityId) activity.setDetail(s.activityId, s.title);
    }
    return false;
  }
  const head = line.slice(0, 400);
  const isMsg = /"type":"(user|assistant)"/.test(head) || /"type":"(user|assistant)","message"/.test(line);
  if (!isMsg) {
    if (line.includes('(id: `chan_')) {
      const name = line.match(PROJECT_NAME)?.[1];
      const sid = name && (JSON.parse(line) as LogLine).sessionId;
      if (name && sid) setProject(sid, cleanTitle(JSON.parse(`"${name}"`) as string), sessions);
    }
    return false;
  }
  // Parsed whole: tool inputs inside a message can carry their own "sessionId", "cwd" or "timestamp".
  let j: LogLine;
  try {
    j = JSON.parse(line) as LogLine;
  } catch {
    return false;
  }
  if (j.isSidechain || (j.type !== 'user' && j.type !== 'assistant')) return false;
  const sid = j.sessionId;
  const ts = Date.parse(j.timestamp ?? '');
  if (!sid || !Number.isFinite(ts)) return false;
  const cwd = j.cwd ?? '';

  let s = sessions.get(sid) ?? loadSession(sid);
  if (!s) {
    // Decided by the session's first prompt: SDK-driven sessions mark it turnOrigin "sdk"; yours say "human".
    // Older CLI versions write no marker at all, and those were typed by hand.
    const origin = j.turnOrigin;
    const project = pendingProjects.get(sid) ?? (cwd ? path.basename(cwd) : 'Claude Code');
    pendingProjects.delete(sid);
    s = { automated: !!origin && origin !== 'human', project, title: '', lastTs: 0, activityId: null };
  } else if (s.automated && j.turnOrigin === 'human') {
    // You took over a session a program started: count it from here on.
    s.automated = false;
  }
  if (s.automated) {
    sessions.set(sid, s);
    return false;
  }
  if (!s.title && j.type === 'user') {
    const t = promptTitle(firstText(j.message?.content));
    if (t && !t.startsWith('[Request interrupted')) s.title = t;
  }
  if (ts <= s.lastTs) {
    sessions.set(sid, s);
    return false;
  }
  if (s.activityId && ts - s.lastTs <= GAP_MS) {
    activity.setEnd(s.activityId, ts + TAIL_MS);
  } else {
    s.activityId = activity.insert({
      kind: 'claude',
      app: 'Claude Code',
      bundleId: j.entrypoint ?? '',
      detail: s.title,
      context: s.project,
      url: '',
      start: ts,
      end: ts + TAIL_MS,
    });
  }
  if (s.title && s.activityId) activity.setDetail(s.activityId, s.title);
  s.lastTs = ts;
  sessions.set(sid, s);
  return true;
}

async function readFrom(file: string, offset: number, size: number, sessions: Map<string, SessionState>) {
  let changed = false;
  let consumed = offset;
  let carry = '';
  const stream = fs.createReadStream(file, { start: offset, end: size - 1, encoding: 'utf8', highWaterMark: 1 << 20 });
  for await (const chunk of stream as AsyncIterable<string>) {
    const text = carry + chunk;
    const lines = text.split('\n');
    carry = lines.pop() ?? '';
    db().transaction(() => {
      for (const l of lines) {
        consumed += Buffer.byteLength(l, 'utf8') + 1;
        if (applyLine(l, sessions)) changed = true;
      }
    })();
  }
  // An unterminated last line is still being written: leave it for the next scan.
  return { changed, offset: consumed };
}

export async function scanClaude(): Promise<boolean> {
  if (scanning || !settings.get().claudeSessions || !settings.get().onboarded || !fs.existsSync(ROOT)) return false;
  scanning = true;
  let changed = false;
  try {
    const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
    const known = new Map(
      (db().prepare('SELECT path, offset, mtime FROM claude_files').all() as { path: string; offset: number; mtime: number }[]).map(
        (r) => [r.path, r],
      ),
    );
    const upsert = db().prepare(
      'INSERT INTO claude_files (path, offset, mtime) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, mtime = excluded.mtime',
    );
    const sessions = new Map<string, SessionState>();
    for (const dir of await fs.promises.readdir(ROOT)) {
      const full = path.join(ROOT, dir);
      let names: string[];
      try {
        names = (await fs.promises.readdir(full)).filter((n) => n.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(full, name);
        const st = await fs.promises.stat(file).catch(() => null);
        if (!st) continue;
        const prev = known.get(file);
        if (prev && prev.mtime === st.mtimeMs && prev.offset >= st.size) continue;
        if (!prev && st.mtimeMs < cutoff) {
          upsert.run(file, st.size, st.mtimeMs);
          continue;
        }
        // A file that shrank was rewritten: read it again from the top.
        const from = prev && prev.offset <= st.size ? prev.offset : 0;
        // Touched but nothing new (offset already at the end): just remember the new mtime.
        if (from >= st.size) {
          upsert.run(file, from, st.mtimeMs);
          continue;
        }
        try {
          const r = await readFrom(file, from, st.size, sessions);
          upsert.run(file, r.offset, st.mtimeMs);
          if (r.changed) changed = true;
        } catch (err) {
          // One unreadable file must not stop the rest of the scan.
          console.warn('[claude] skipped', file, err);
        }
      }
    }
    for (const [id, s] of sessions) saveSession(id, s);
    lastScan = Date.now();
  } finally {
    scanning = false;
  }
  return changed;
}

export function startClaudeWatcher(changed: () => void) {
  const run = () =>
    void scanClaude()
      .then((c) => c && changed())
      .catch((e) => console.error('[claude] scan failed', e));
  run();
  timer = setInterval(run, SCAN_MS);
}

export function stopClaudeWatcher() {
  if (timer) clearInterval(timer);
}
