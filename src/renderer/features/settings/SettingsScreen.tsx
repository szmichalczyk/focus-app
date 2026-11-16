import { useState } from 'react';
import { api, isNative, useMonitorStatus, useSaveSettings, useSettings } from '@/renderer/lib/api';
import { LoButton } from '@/renderer/components/LoButton';
import { LoSelect } from '@/renderer/components/LoSelect';
import { useQueryClient } from '@tanstack/react-query';

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'CZK'];

export function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="fo-setting">
      <span className="fo-setting-text">
        <span className="lo-title">{label}</span>
        <span className="lo-meta">{hint}</span>
      </span>
      <span className="fo-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="fo-switch-track" aria-hidden="true" />
      </span>
    </label>
  );
}

export function SettingsScreen() {
  const s = useSettings().data;
  const status = useMonitorStatus().data;
  const save = useSaveSettings();
  const qc = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  if (!s) return null;

  return (
    <div className="page fo-page">
      <div className="page-inner fo-narrow">
        <div className="fo-pagehead">
          <div>
            <h1 className="fo-headline">Settings</h1>
          </div>
        </div>

        <h2 className="lo-h2 fo-section-title">Activity monitor</h2>
        <div className="lo-card fo-settings">
          <Toggle
            label="Record activity"
            hint="Samples the app in front and its window every 5 seconds. Stored only in a local database on this Mac."
            checked={s.monitorEnabled}
            onChange={(v) => save.mutate({ monitorEnabled: v })}
          />
          <div className="fo-setting">
            <span className="fo-setting-text">
              <span className="lo-title">Window titles</span>
              <span className="lo-meta">
                {status?.accessibility
                  ? 'Allowed. Focus sees files, documents and window names.'
                  : 'Needs Accessibility access (Privacy & Security). Without it, only app names are recorded.'}
              </span>
            </span>
            {status?.accessibility ? (
              <span className="fo-ok">Allowed</span>
            ) : (
              <LoButton small onClick={() => api.monitor.requestAccess().then(() => qc.invalidateQueries({ queryKey: ['monitor'] }))} disabled={!isNative}>
                Allow access
              </LoButton>
            )}
          </div>
          <Toggle
            label="Browser tabs"
            hint="Reads the active tab's title and address in Arc, Chrome, Brave, Edge and Safari. macOS asks once per browser."
            checked={s.browserTabs}
            onChange={(v) => save.mutate({ browserTabs: v })}
          />
          <Toggle
            label="Claude Code sessions"
            hint="Reads session logs in ~/.claude/projects: the project, the session title (or the start of your first prompt) and when you worked. Nothing else from the conversation is kept."
            checked={s.claudeSessions}
            onChange={(v) => save.mutate({ claudeSessions: v })}
          />
          <Toggle
            label="Codex sessions"
            hint="Reads session logs in ~/.codex/sessions: the project, the thread name (or the start of your first prompt) and when you worked. Reviewer and subagent threads are skipped. Nothing else from the conversation is kept."
            checked={s.codexSessions}
            onChange={(v) => save.mutate({ codexSessions: v })}
          />
          <div className="fo-setting">
            <span className="fo-setting-text">
              <span className="lo-title">Pause when idle</span>
              <span className="lo-meta">Stop counting after this long without keyboard or mouse input.</span>
            </span>
            <div className="fo-setting-ctl">
              <LoSelect value={String(s.idleMinutes)} onChange={(e) => save.mutate({ idleMinutes: Number(e.target.value) })} aria-label="Idle threshold">
                {[1, 2, 3, 5, 10, 15].map((m) => (
                  <option key={m} value={String(m)}>
                    {m} min
                  </option>
                ))}
              </LoSelect>
            </div>
          </div>
        </div>

        <h2 className="lo-h2 fo-section-title">Time tracking</h2>
        <div className="lo-card fo-settings">
          <div className="fo-setting">
            <span className="fo-setting-text">
              <span className="lo-title">Default currency</span>
              <span className="lo-meta">For new projects. Each project keeps its own currency.</span>
            </span>
            <div className="fo-setting-ctl">
              <LoSelect value={s.currency} onChange={(e) => save.mutate({ currency: e.target.value })} aria-label="Default currency">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </LoSelect>
            </div>
          </div>
          <div className="fo-setting">
            <span className="fo-setting-text">
              <span className="lo-title">Week view starts at</span>
              <span className="lo-meta">The hour the calendar scrolls to when it opens.</span>
            </span>
            <div className="fo-setting-ctl">
              <LoSelect value={String(s.dayStartHour)} onChange={(e) => save.mutate({ dayStartHour: Number(e.target.value) })} aria-label="Day start">
                {Array.from({ length: 13 }, (_, h) => h).map((h) => (
                  <option key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </LoSelect>
            </div>
          </div>
        </div>

        <h2 className="lo-h2 fo-section-title">Data</h2>
        <div className="lo-card fo-settings">
          <div className="fo-setting">
            <span className="fo-setting-text">
              <span className="lo-title">Delete activity history</span>
              <span className="lo-meta">
                {confirmClear
                  ? 'This removes every recorded app, window, Claude Code and Codex session. Time entries and projects stay. It cannot be undone.'
                  : 'Removes recorded activity. Time entries and projects are kept.'}
              </span>
            </span>
            <div className="fo-setting-ctl">
              {confirmClear ? (
                <>
                  <LoButton small onClick={() => setConfirmClear(false)}>
                    Keep
                  </LoButton>
                  <LoButton
                    small
                    variant="danger"
                    onClick={async () => {
                      await api.activity.clear();
                      setConfirmClear(false);
                      void qc.invalidateQueries({ queryKey: ['activity'] });
                    }}
                  >
                    Delete activity history
                  </LoButton>
                </>
              ) : (
                <LoButton small onClick={() => setConfirmClear(true)}>
                  Delete…
                </LoButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
