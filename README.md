# Focus

**A calm, local time tracker for macOS that also shows you what you actually did.**

Focus puts two streams side by side: the time you *log* (projects, entries, billable hours) and the time you *spent*: which apps, windows, browser tabs, and Claude Code and Codex sessions were in front of you. Drag a block of real activity onto the calendar and it becomes an entry. No account, no cloud, no sync. Everything lives in one SQLite file on your Mac.

![Focus: the week calendar with time entries and the activity strip next to each day](docs/screenshots/timer.jpg)

**[Download for Mac (Apple Silicon)](../../releases/latest)** · [What's new](CHANGELOG.md)

## Features

### Timer and calendar
- One-line timer bar: what you're doing, the project, billable on/off, start/stop. The same timer sits in the menu bar.
- Week calendar: drag to draw an entry, drag to move it (also across days), drag the bottom edge to resize, click to edit.
- Overlapping entries sit side by side instead of on top of each other.
- Three views: **Mix** (entries plus a thin activity strip), **Time** (entries only) and **Activity** (what the computer saw).
- Click any activity block to see its windows and log it as an entry in one step.

### Automatic activity
- Records the frontmost app and window title every few seconds, and the active tab in Chromium browsers and Safari.
- Pauses on idle, lock and sleep, so breaks don't count as work.
- Reads your Claude Code and Codex sessions and shows them by project and session title. Reviewer and subagent threads are left out.
- Focus never tracks itself.

![The calendar in Activity view: blocks of real computer use with the apps in each](docs/screenshots/activity-calendar.jpg)

### Activity insights
- Active time by hour (heatmap) and by day (stacked by app).
- Top apps with trend sparklines, and "where the time went" down to the window or session.

![Activity: active time by hour and by day, top apps and where the time went](docs/screenshots/activity.jpg)

### Reports
- Hours and earnings by day, week, month, year or **all time**. Long ranges group by month, then by year.
- Per-project breakdown (donut plus table), entry list and CSV export.
- Hourly rates per project. Earnings in different currencies are never added together.

![Reports: tracked, billable, earned and active time, hours by day stacked by project](docs/screenshots/reports.jpg)

### Projects
- Colours, clients, rates and billable-by-default per project.
- A report page for every project, from its first entry to today. Archive finished ones.

![A project report: hours by day, the apps used while tracking, and the files, tabs and windows](docs/screenshots/project.jpg)

### Made for the Mac
- Native-feeling UI: translucent sidebar, SF Symbols, SF Pro, squircle shapes.
- Private by design: no network calls, no telemetry. Your data stays in `~/Library/Application Support/Focus/focus.db`.

## Install

Requires a Mac with Apple Silicon (M1 or later).

1. Download `Focus-darwin-arm64-*.zip` from the [latest release](../../releases/latest), unzip it and move **Focus.app** to Applications.
2. Open it. Focus isn't signed with an Apple developer certificate yet, so macOS says it can't verify the app. Click **Done**.
3. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to Focus, then confirm.

You only do this once. Prefer the terminal? This does the same:

```bash
xattr -dr com.apple.quarantine /Applications/Focus.app
```

### Permissions
- **Accessibility** (System Settings → Privacy & Security → Accessibility) lets Focus read window titles.
- **Automation** lets it read the current browser tab. macOS asks once per browser.

Without these, Focus still tracks which app is in front.

## Build from source

Requires macOS, Node 20+ and Xcode Command Line Tools.

```bash
npm install
npm run make       # builds Focus.app into out/Focus-darwin-arm64/
```

Move `out/Focus-darwin-arm64/Focus.app` to Applications and open it. To run it from source while you work on it, use `npm start`.

### What's where
- `src/main/db.ts`: SQLite (better-sqlite3) holding projects, entries, activity and settings. Migrations are an append-only array.
- `src/main/monitor.ts`: samples the frontmost app, window title and browser tab, and pauses on idle, lock and sleep.
- `src/main/claudeSessions.ts`: reads Claude Code session logs incrementally and turns them into activity runs.
- `src/main/tray.ts`: the menu-bar timer.
- `src/renderer/features/`: the calendar, activity, reports, projects and settings screens.

Built with Electron Forge, Vite, React 19, TypeScript and Reshaped.

## License

MIT

---

## You like the app?

Buy me a pizza so I have enough energy to build the next ones!

<a href="https://www.buymeacoffee.com/szmichalczyk"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20pizza&emoji=%F0%9F%8D%95&slug=szmichalczyk&button_colour=FFDD00&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a pizza" height="48"></a>
