import { execFile } from 'node:child_process';
import { db } from './db';

/**
 * Real app icons for the activity views. App name → bundle id (from recorded activity) → PNG data URL, cached for
 * the session.
 */

const cache = new Map<string, string | null>();

/** Names that are not a running app's process name. */
const ALIASES: Record<string, string> = {
  'Claude Code': 'com.anthropic.claudefordesktop',
  Codex: 'com.openai.codex',
};
/** Apps launched from source all carry Electron's generic icon; a letter badge says more. */
const GENERIC = new Set(['com.github.Electron']);

function bundleFor(name: string): string | null {
  if (ALIASES[name]) return ALIASES[name];
  const r = db()
    .prepare("SELECT bundle_id AS b FROM activity WHERE app = ? AND kind = 'app' AND bundle_id != '' ORDER BY id DESC LIMIT 1")
    .get(name) as { b: string } | undefined;
  return r?.b ?? null;
}

/**
 * One JXA call for all misses: bundle id → app path (NSWorkspace) → its icon drawn into a 64px bitmap → PNG base64.
 * (Electron's app.getFileIcon returns the generic app icon for .app bundles, so it can't be used here.)
 */
function loadIcons(bundleIds: string[]): Promise<Record<string, string>> {
  if (!bundleIds.length) return Promise.resolve({});
  const script = `
ObjC.import('AppKit');
function run() {
  var ids = ${JSON.stringify(bundleIds)};
  var out = {};
  var ws = $.NSWorkspace.sharedWorkspace;
  var px = 64;
  for (var i = 0; i < ids.length; i++) {
    try {
      var u = ws.URLForApplicationWithBundleIdentifier(ids[i]);
      if (!u || u.isNil()) continue;
      var img = ws.iconForFile(u.path);
      var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, px, px, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
      $.NSGraphicsContext.saveGraphicsState;
      $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
      img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, px, px), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
      $.NSGraphicsContext.restoreGraphicsState;
      out[ids[i]] = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).base64EncodedStringWithOptions(0).js;
    } catch (e) {}
  }
  return JSON.stringify(out);
}`;
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 10_000, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) return resolve({});
      try {
        resolve(JSON.parse(String(stdout).trim()));
      } catch {
        resolve({});
      }
    });
  });
}

export async function appIcons(names: string[]): Promise<Record<string, string | null>> {
  const misses = names.filter((n) => !cache.has(n));
  if (misses.length && process.platform === 'darwin') {
    const bundles = new Map<string, string>();
    for (const n of misses) {
      const b = bundleFor(n);
      if (b && !GENERIC.has(b)) bundles.set(n, b);
      else cache.set(n, null);
    }
    const pngs = await loadIcons([...new Set(bundles.values())]);
    for (const [n, b] of bundles) cache.set(n, pngs[b] ? `data:image/png;base64,${pngs[b]}` : null);
  }
  return Object.fromEntries(names.map((n) => [n, cache.get(n) ?? null]));
}
