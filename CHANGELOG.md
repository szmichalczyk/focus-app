# Changelog

All notable changes to Focus. Downloads are on the [releases page](../../releases).

## 0.3.4 — 2026-11-16

### Added
- **Codex session tracking.** Focus now reads Codex session logs (`~/.codex/sessions`) next to Claude Code ones. Each session shows up as Codex in the activity stream, Activity and project reports, with the project folder and the thread name (or the start of your first prompt). Renamed threads follow along.
- Codex reviewer, subagent and `codex exec` threads are skipped, so only sessions you started count.
- A **Codex sessions** switch in the welcome screen and in Settings (on by default). Nothing from the conversation itself is kept.

### Changed
- Claude Code and Codex are grouped the same way: "Group sessions by" Project or Session.

## 0.3.3 — 2026-11-16

### Fixed
- No more Keychain password prompt for "Focus Safe Storage". Focus doesn't use the Keychain at all now. If you saw the prompt, you can delete that item in Keychain Access.

## 0.3.2 — 2026-11-16

### Fixed
- Downloaded copies no longer read as "damaged": the finished app is re-signed so its signature is valid.
- Building from a fresh clone (`npm install && npm run make`) produces an app that opens.

### Docs
- Current macOS steps for opening an app from an unidentified developer. Apple Silicon only.

## 0.3.1 — 2026-11-16

### Fixed
- The packaged app crashed on start ("Cannot find module 'better-sqlite3'"). The database module now ships inside the app.

## 0.3.0 — 2026-11-16

### Added
- First-launch welcome: what Focus records, a switch per source and the Accessibility step. Nothing is recorded until you finish it.
- Empty states for the calendar, reports and sidebar, and an Accessibility nudge.
- Error states: a screen that fails shows a retry instead of going blank, and a banner appears when data can't be read.
- Press feedback on calendar tiles, SF Symbols throughout, unified sidebar rows.

## 0.2.0

- First public version: timer and week calendar, automatic activity (apps, windows, browser tabs, Claude Code sessions), reports and projects.
