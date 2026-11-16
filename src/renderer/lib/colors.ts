/** Project colours (LeaderOS person palette). No orange: orange means "needs attention". */
export const PROJECT_COLORS = [
  '#3b7ddd',
  '#d9488a',
  '#2f9e8f',
  '#b98a1e',
  '#6c56d9',
  '#3f8f4f',
  '#c23a4b',
  '#5b6b8c',
  '#2a9bc4',
  '#9a4fa0',
  '#78872c',
  '#2f4b8a',
];

/** Entries without a project. */
export const NO_PROJECT = '#8a93a3';

/** Stable, muted colours for apps in the activity stream: hue from the name, low saturation, so entries stay the loud layer. */
const KNOWN: Record<string, string> = {
  'Claude Code': '#c96442',
  Claude: '#c96442',
  Codex: '#3f6f8f',
  Figma: '#a259ff',
  'Google Chrome': '#4c84e8',
  Arc: '#e0557a',
  Safari: '#2a9bc4',
  Slack: '#611f69',
  'Visual Studio Code': '#2f7ec7',
  Code: '#2f7ec7',
  Cursor: '#3b4558',
  Terminal: '#3b4558',
  iTerm2: '#3b4558',
  Ghostty: '#3b4558',
  Notion: '#4d5667',
  Mail: '#3b7ddd',
  Messages: '#2fa36b',
  Zoom: '#2d8cff',
  Spotify: '#1db954',
  Finder: '#5b8def',
  Focus: '#1b2230',
};

export function appColor(app: string) {
  if (KNOWN[app]) return KNOWN[app];
  let h = 0;
  for (let i = 0; i < app.length; i++) h = (h * 31 + app.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 58% 54%)`;
}

export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, white)`;
