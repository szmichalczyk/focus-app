// Shared between the main process and the renderer. All times are epoch milliseconds.

export interface Project {
  id: string;
  name: string;
  client: string;
  color: string;
  /** Hourly rate in `currency`. 0 = internal / not billed. */
  rate: number;
  currency: string;
  /** New entries on this project start as billable. */
  billableByDefault: boolean;
  archived: boolean;
  createdAt: number;
}
export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'archived'> & { archived?: boolean };
export type ProjectPatch = Partial<ProjectInput>;

export type EntrySource = 'manual' | 'calendar' | 'timer' | 'activity';

export interface TimeEntry {
  id: string;
  projectId: string | null;
  description: string;
  start: number;
  /** null while the timer is running. */
  end: number | null;
  billable: boolean;
  source: EntrySource;
}
export type EntryInput = Omit<TimeEntry, 'id'>;
export type EntryPatch = Partial<EntryInput>;

/**
 * `app`: the frontmost window, sampled. `claude`: a Claude Code session, read from ~/.claude/projects.
 * `codex`: a Codex session, read from ~/.codex/sessions.
 */
export type ActivityKind = 'app' | 'claude' | 'codex';

/** Coding-agent sessions run alongside whatever app is in front; their `app` is the agent's name. */
export const AGENT_APPS = { claude: 'Claude Code', codex: 'Codex' } as const;
export const isAgent = (a: { kind: ActivityKind }) => a.kind !== 'app';
export const isAgentApp = (name: string | null | undefined) => name === AGENT_APPS.claude || name === AGENT_APPS.codex;

export interface Activity {
  id: number;
  kind: ActivityKind;
  /** App name ("Figma", "Google Chrome"), or the agent ("Claude Code", "Codex"). */
  app: string;
  bundleId: string;
  /** What inside the app: window title / file / tab title / session title. */
  detail: string;
  /** Secondary context: web host for browsers, project folder for agent sessions. */
  context: string;
  url: string;
  start: number;
  end: number;
}

export interface Settings {
  currency: string;
  monitorEnabled: boolean;
  /** Stop counting after this many minutes without keyboard or mouse input. */
  idleMinutes: number;
  browserTabs: boolean;
  claudeSessions: boolean;
  codexSessions: boolean;
  /** Hour the week view scrolls to when it opens. */
  dayStartHour: number;
  /** Set when the first-run welcome is finished. Nothing is recorded before that. */
  onboarded: boolean;
}

export interface MonitorStatus {
  enabled: boolean;
  /** Accessibility access lets Focus read window titles (otherwise only the app name is known). */
  accessibility: boolean;
  idle: boolean;
  current: { app: string; detail: string; since: number } | null;
  claudeLastScan: number | null;
  /** Available only inside the Mac app. */
  native: boolean;
}

export interface Range {
  from: number;
  to: number;
}
