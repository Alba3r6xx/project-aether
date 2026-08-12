'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RadioTower,
  Trash2,
  Wifi,
} from 'lucide-react';
import Toggle from '../common/Toggle';
import { cn } from '../../utils/cn';
import {
  fetchDeviceSettings,
  publishDeviceConfig,
  saveDeviceSettings,
} from '../../services/historyService';

const MAX_WIFI_ENTRIES = 3;

// Bounds mirror the CHECK constraints in supabase/migrations/0008_device_settings.sql.
// Validating here as well keeps the user out of a round-trip that the database
// would reject anyway.
const BOUNDS = {
  co2_warn_ppm: { min: 400, max: 40000 },
  co2_hazard_ppm: { min: 400, max: 50000 },
  quiet_hours_start: { min: 0, max: 23 },
  quiet_hours_end: { min: 0, max: 23 },
  display_page_seconds: { min: 2, max: 60 },
};

const DEFAULTS = {
  co2_warn_ppm: 2000,
  co2_hazard_ppm: 5000,
  buzzer_enabled: true,
  quiet_hours_start: 22,
  quiet_hours_end: 7,
  timezone_offset_minutes: 0,
  display_page_seconds: 5,
};

// GMT-12 .. GMT+14 in whole hours. Values are MINUTES because that is what the
// firmware consumes (the column allows 45-minute zones, but the common list is
// hourly and keeps the select usable).
const TIMEZONE_OPTIONS = (() => {
  const options = [];
  for (let hour = -12; hour <= 14; hour += 1) {
    const sign = hour < 0 ? '-' : '+';
    const label =
      hour === 0 ? 'GMT+0 (Ghana / UTC)' : `GMT${sign}${Math.abs(hour)}`;
    options.push({ value: hour * 60, label });
  }
  return options;
})();

const FIELD_CLASS =
  'min-h-[44px] w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus-ring';
const LABEL_CLASS = 'mb-1 block text-xs font-medium text-slate-300';

function clampInt(value, { min, max }, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** The keys the device echoes back on its state topic. */
const CONFIG_KEYS = Object.keys(DEFAULTS);

/**
 * True when the device's last reported config matches the saved (desired)
 * settings. A mismatch means the node hasn't applied the latest push yet.
 */
function isReportedInSync(saved, reported) {
  if (!reported || typeof reported !== 'object') return false;
  return CONFIG_KEYS.every((key) => {
    if (reported[key] === undefined) return false;
    if (typeof saved[key] === 'boolean') return Boolean(reported[key]) === saved[key];
    return Number(reported[key]) === Number(saved[key]);
  });
}

function Skeleton() {
  return (
    <div className="mt-5 animate-pulse space-y-3" aria-hidden="true">
      <div className="h-11 rounded-lg bg-white/5" />
      <div className="h-11 rounded-lg bg-white/5" />
      <div className="h-11 rounded-lg bg-white/5" />
      <div className="h-11 w-2/3 rounded-lg bg-white/5" />
    </div>
  );
}

/**
 * Per-device configuration card. Reads/writes the `device_settings` row for
 * one node and asks the publish-config Edge Function to push it to the
 * hardware over MQTT.
 */
export default function DeviceSettings({ node }) {
  const nodeId = node?.id;

  const [form, setForm] = useState(DEFAULTS);
  const [saved, setSaved] = useState(null);
  const [reported, setReported] = useState({ config: null, at: null });
  const [wifi, setWifi] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [validationError, setValidationError] = useState('');
  // status.state: idle | saving | synced | pending | failed
  const [status, setStatus] = useState({ state: 'idle', message: '' });

  useEffect(() => {
    if (!nodeId) return undefined;

    let cancelled = false;
    setIsLoading(true);
    setStatus({ state: 'idle', message: '' });
    setValidationError('');
    setWifi([]);

    fetchDeviceSettings(nodeId)
      .then((row) => {
        if (cancelled) return;
        const next = row
          ? {
              co2_warn_ppm: row.co2_warn_ppm,
              co2_hazard_ppm: row.co2_hazard_ppm,
              buzzer_enabled: row.buzzer_enabled,
              quiet_hours_start: row.quiet_hours_start,
              quiet_hours_end: row.quiet_hours_end,
              timezone_offset_minutes: row.timezone_offset_minutes,
              display_page_seconds: row.display_page_seconds,
            }
          : DEFAULTS;
        setForm(next);
        setSaved(next);
        setReported({ config: row?.reported_config ?? null, at: row?.reported_at ?? null });
      })
      .catch(() => {
        if (!cancelled) {
          setForm(DEFAULTS);
          setSaved(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setValidationError('');
    setStatus({ state: 'idle', message: '' });
  }, []);

  const pendingSync = useMemo(() => {
    if (!saved) return false;
    return !isReportedInSync(saved, reported.config);
  }, [saved, reported.config]);

  function validate(next) {
    for (const [key, bounds] of Object.entries(BOUNDS)) {
      const value = Number(next[key]);
      if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
        return `${key.replaceAll('_', ' ')} must be between ${bounds.min} and ${bounds.max}.`;
      }
    }
    if (Number(next.co2_hazard_ppm) < Number(next.co2_warn_ppm)) {
      return 'The hazard threshold must be greater than or equal to the warning threshold.';
    }
    for (const entry of wifi) {
      if (!entry.ssid.trim()) return 'Every backup WiFi network needs an SSID (or remove the row).';
      if (entry.ssid.length > 32) return 'A WiFi SSID cannot be longer than 32 characters.';
      if (entry.password.length > 63) return 'A WiFi password cannot be longer than 63 characters.';
    }
    return '';
  }

  async function handleSave() {
    const error = validate(form);
    if (error) {
      setValidationError(error);
      setStatus({ state: 'failed', message: error });
      return;
    }

    setValidationError('');
    setStatus({ state: 'saving', message: 'Saving settings and syncing to the device\u2026' });

    const patch = {
      co2_warn_ppm: Number(form.co2_warn_ppm),
      co2_hazard_ppm: Number(form.co2_hazard_ppm),
      buzzer_enabled: Boolean(form.buzzer_enabled),
      quiet_hours_start: Number(form.quiet_hours_start),
      quiet_hours_end: Number(form.quiet_hours_end),
      timezone_offset_minutes: Number(form.timezone_offset_minutes),
      display_page_seconds: Number(form.display_page_seconds),
    };

    let savedRow;
    try {
      savedRow = await saveDeviceSettings(nodeId, patch);
    } catch (err) {
      setStatus({
        state: 'failed',
        message: err.message || 'Could not save these settings. Nothing was changed.',
      });
      return;
    }

    setSaved(patch);
    if (savedRow) {
      setReported({ config: savedRow.reported_config ?? null, at: savedRow.reported_at ?? null });
    }

    // WiFi credentials are pass-through only: sent to the device, never stored.
    const cleanWifi = wifi
      .filter((entry) => entry.ssid.trim())
      .map((entry) => ({ ssid: entry.ssid.trim(), password: entry.password }));

    try {
      await publishDeviceConfig(nodeId, cleanWifi.length > 0 ? cleanWifi : undefined);
      setStatus({
        state: 'synced',
        message: 'Settings saved and sent to the device.',
      });
      // Credentials live only as long as the request that carried them.
      setWifi([]);
    } catch (err) {
      // The Edge Function publishes with retain=true, so a config that was
      // never delivered is still queued on the broker for the node's return.
      setStatus({
        state: 'pending',
        message: `Settings saved, but the device could not be reached (${
          err.message || 'no response'
        }). They will apply when it reconnects.`,
      });
    }
  }

  function addWifiRow() {
    setWifi((prev) => (prev.length >= MAX_WIFI_ENTRIES ? prev : [...prev, { ssid: '', password: '' }]));
  }

  function removeWifiRow(index) {
    setWifi((prev) => prev.filter((_, i) => i !== index));
  }

  function updateWifiRow(index, key, value) {
    setWifi((prev) => prev.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  }

  if (!nodeId) {
    return (
      <section className="rounded-2xl border border-white/5 bg-navy-900 p-6">
        <h2 className="font-display text-base font-semibold text-white">Device configuration</h2>
        <p className="mt-2 text-xs text-slate-400">
          Claim a node first — device configuration applies to a specific piece of hardware.
        </p>
      </section>
    );
  }

  const statusTone =
    status.state === 'synced'
      ? 'bg-emerald-400/10 text-emerald-300'
      : status.state === 'failed'
        ? 'bg-rose-400/10 text-rose-300'
        : status.state === 'pending'
          ? 'bg-amber-400/10 text-amber-300'
          : 'bg-white/5 text-slate-300';

  const reportedAt = reported.at ? new Date(reported.at).toLocaleString() : null;

  return (
    <section className="rounded-2xl border border-white/5 bg-navy-900 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-white">Device configuration</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">{node.name || nodeId}</p>
        </div>
        {!isLoading && pendingSync && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300">
            <RadioTower size={11} />
            Pending sync
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton />
      ) : (
        <div className="mt-5 space-y-5">
          {/* CO2 thresholds */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="co2-warn">
                CO&#8322; warning threshold (ppm)
              </label>
              <input
                id="co2-warn"
                type="number"
                inputMode="numeric"
                min={BOUNDS.co2_warn_ppm.min}
                max={BOUNDS.co2_warn_ppm.max}
                value={form.co2_warn_ppm}
                onChange={(e) => setField('co2_warn_ppm', e.target.value)}
                onBlur={(e) =>
                  setField('co2_warn_ppm', clampInt(e.target.value, BOUNDS.co2_warn_ppm, DEFAULTS.co2_warn_ppm))
                }
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="co2-hazard">
                CO&#8322; hazard threshold (ppm)
              </label>
              <input
                id="co2-hazard"
                type="number"
                inputMode="numeric"
                min={BOUNDS.co2_hazard_ppm.min}
                max={BOUNDS.co2_hazard_ppm.max}
                value={form.co2_hazard_ppm}
                onChange={(e) => setField('co2_hazard_ppm', e.target.value)}
                onBlur={(e) =>
                  setField('co2_hazard_ppm', clampInt(e.target.value, BOUNDS.co2_hazard_ppm, DEFAULTS.co2_hazard_ppm))
                }
                className={FIELD_CLASS}
              />
            </div>
          </div>

          {/* Buzzer */}
          <div className="border-t border-white/5 pt-1">
            <Toggle
              label="Buzzer enabled"
              description="Audible alarm on the device when a hazard threshold is crossed."
              checked={Boolean(form.buzzer_enabled)}
              onChange={(v) => setField('buzzer_enabled', v)}
            />
          </div>

          {/* Quiet hours */}
          <div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS} htmlFor="quiet-start">
                  Quiet hours start (hour, 0&ndash;23)
                </label>
                <input
                  id="quiet-start"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={23}
                  value={form.quiet_hours_start}
                  onChange={(e) => setField('quiet_hours_start', e.target.value)}
                  onBlur={(e) =>
                    setField('quiet_hours_start', clampInt(e.target.value, BOUNDS.quiet_hours_start, DEFAULTS.quiet_hours_start))
                  }
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS} htmlFor="quiet-end">
                  Quiet hours end (hour, 0&ndash;23)
                </label>
                <input
                  id="quiet-end"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={23}
                  value={form.quiet_hours_end}
                  onChange={(e) => setField('quiet_hours_end', e.target.value)}
                  onBlur={(e) =>
                    setField('quiet_hours_end', clampInt(e.target.value, BOUNDS.quiet_hours_end, DEFAULTS.quiet_hours_end))
                  }
                  className={FIELD_CLASS}
                />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              During quiet hours the device suppresses warning-level buzzing. Hazard alarms always
              sound, at any hour.
            </p>
          </div>

          {/* Timezone */}
          <div>
            <label className={LABEL_CLASS} htmlFor="tz-offset">
              Timezone offset
            </label>
            <select
              id="tz-offset"
              value={form.timezone_offset_minutes}
              onChange={(e) => setField('timezone_offset_minutes', Number(e.target.value))}
              className={FIELD_CLASS}
            >
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-navy-900">
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              The device has no timezone database, so it needs a fixed offset for quiet hours and
              on-screen clocks.
            </p>
          </div>

          {/* Display page duration */}
          <div>
            <label className={LABEL_CLASS} htmlFor="display-seconds">
              Display page duration (seconds)
            </label>
            <input
              id="display-seconds"
              type="number"
              inputMode="numeric"
              min={2}
              max={60}
              value={form.display_page_seconds}
              onChange={(e) => setField('display_page_seconds', e.target.value)}
              onBlur={(e) =>
                setField('display_page_seconds', clampInt(e.target.value, BOUNDS.display_page_seconds, DEFAULTS.display_page_seconds))
              }
              className={FIELD_CLASS}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              How long each page stays on the OLED before rotating to the next one.
            </p>
          </div>

          {/* Backup WiFi */}
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-white">
                <Wifi size={13} className="text-sky-400" />
                Backup WiFi networks
              </h3>
              <button
                type="button"
                onClick={addWifiRow}
                disabled={wifi.length >= MAX_WIFI_ENTRIES}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-400/20 disabled:opacity-40 focus-ring"
              >
                <Plus size={13} />
                Add network
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              First-time setup must be done on the device itself, via its{' '}
              <span className="font-mono text-slate-400">Aether-Setup-XXXX</span> hotspot — an
              offline device cannot receive settings from the cloud. These entries are fallback
              networks for a device that is already online.
            </p>
            <p className="mt-1.5 text-xs text-amber-300/80">
              WiFi passwords are sent straight to the device and are never stored in the database.
            </p>

            {wifi.length === 0 ? (
              <p className="mt-3 text-xs text-slate-600">
                No backup networks queued. Up to {MAX_WIFI_ENTRIES} can be sent with the next sync.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {wifi.map((entry, index) => (
                  <li key={index} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <div>
                      <label className={LABEL_CLASS} htmlFor={`wifi-ssid-${index}`}>
                        Network {index + 1} SSID
                      </label>
                      <input
                        id={`wifi-ssid-${index}`}
                        type="text"
                        maxLength={32}
                        value={entry.ssid}
                        onChange={(e) => updateWifiRow(index, 'ssid', e.target.value)}
                        placeholder="e.g. Aether-Lab"
                        className={FIELD_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS} htmlFor={`wifi-pass-${index}`}>
                        Network {index + 1} password
                      </label>
                      <input
                        id={`wifi-pass-${index}`}
                        type="password"
                        maxLength={63}
                        autoComplete="new-password"
                        value={entry.password}
                        onChange={(e) => updateWifiRow(index, 'password', e.target.value)}
                        className={FIELD_CLASS}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeWifiRow(index)}
                        aria-label={`Remove backup network ${index + 1}`}
                        className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/5 text-slate-400 transition-colors hover:bg-rose-400/10 hover:text-rose-300 focus-ring"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Validation */}
          {validationError && (
            <p className="flex items-center gap-2 rounded-lg bg-rose-400/10 p-3 text-xs text-rose-300">
              <AlertCircle size={14} className="shrink-0" />
              {validationError}
            </p>
          )}

          {/* Save */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={status.state === 'saving'}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-navy-950 transition-colors hover:bg-sky-300 disabled:opacity-50 focus-ring sm:w-auto sm:self-start"
            >
              {status.state === 'saving' && <Loader2 size={14} className="animate-spin" />}
              Save &amp; sync to device
            </button>

            <p
              role="status"
              aria-live="polite"
              className={cn(
                'flex items-start gap-2 rounded-lg p-3 text-xs',
                statusTone,
                status.message ? '' : 'sr-only'
              )}
            >
              {status.state === 'synced' && <CheckCircle2 size={14} className="mt-px shrink-0" />}
              {(status.state === 'failed' || status.state === 'pending') && (
                <AlertCircle size={14} className="mt-px shrink-0" />
              )}
              {status.message}
            </p>
          </div>

          {/* Reported state */}
          <div className="border-t border-white/5 pt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Last reported by device
            </h3>
            {reportedAt && reported.config ? (
              <>
                <p className="mt-1 text-xs text-slate-500">{reportedAt}</p>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  {CONFIG_KEYS.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-2">
                      <dt className="truncate text-xs text-slate-500">{key.replaceAll('_', ' ')}</dt>
                      <dd className="text-xs font-medium text-slate-300">
                        {reported.config[key] === undefined
                          ? '—'
                          : String(reported.config[key])}
                      </dd>
                    </div>
                  ))}
                </dl>
                {pendingSync && (
                  <p className="mt-2 text-xs text-amber-300/80">
                    This differs from the settings above — the device has not confirmed the latest
                    configuration yet.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-600">
                This device has not reported its configuration yet.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
