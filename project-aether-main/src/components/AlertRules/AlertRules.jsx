'use client';

import { useEffect, useState } from 'react';
import { AlertOctagon, AlertTriangle, BellOff, Info, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import Toggle from '../common/Toggle';
import { cn } from '../../utils/cn';
import {
  createAlertRule,
  deleteAlertRule,
  fetchAlertRules,
  fetchNodes,
  updateAlertRule,
} from '../../services/historyService';

// Mirrors SEVERITY_CONFIG in components/AlertsPanel/AlertsPanel.jsx so a
// "critical" rule reads the same rose as the alert it will eventually raise.
const SEVERITY_CONFIG = {
  critical: { icon: AlertOctagon, color: 'text-rose-400', bg: 'bg-rose-400/10', border: 'border-rose-400/15' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/15' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/15' },
};

function getSeverityConfig(severity) {
  return SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
}

// Values match the CHECK constraints in 0003_alerting.sql.
const METRICS = [
  { value: 'temperature', label: 'Temperature' },
  { value: 'humidity', label: 'Humidity' },
  { value: 'air_quality', label: 'Air quality' },
  { value: 'luminosity', label: 'Luminosity' },
  { value: 'heat_index', label: 'Heat index' },
  { value: 'comfort_index', label: 'Comfort index' },
];

const OPERATORS = [
  { value: 'gt', label: 'is above (>)' },
  { value: 'gte', label: 'is at or above (\u2265)' },
  { value: 'lt', label: 'is below (<)' },
  { value: 'lte', label: 'is at or below (\u2264)' },
];

const SEVERITIES = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

const EMPTY_RULE = {
  metric: 'temperature',
  operator: 'gt',
  threshold: 30,
  severity: 'warning',
  cooldown_minutes: 30,
  enabled: true,
  node_id: '',
};

const FIELD_CLASS =
  'min-h-[44px] w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus-ring';
const LABEL_CLASS = 'mb-1 block text-xs font-medium text-slate-300';

function labelFor(list, value) {
  return list.find((item) => item.value === value)?.label ?? value;
}

/**
 * Create/edit form for a single rule. Rendered inline for edits and at the
 * top of the list for a new rule, so the user never leaves the page.
 */
function RuleForm({ initial, nodes, onCancel, onSubmit, isBusy, idPrefix }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError('');
  }

  function handleSubmit(e) {
    e.preventDefault();
    const threshold = Number(draft.threshold);
    const cooldown = Number.parseInt(draft.cooldown_minutes, 10);
    if (!Number.isFinite(threshold)) {
      setError('Threshold must be a number.');
      return;
    }
    if (!Number.isInteger(cooldown) || cooldown < 0) {
      setError('Cooldown must be zero or more minutes.');
      return;
    }
    onSubmit({
      metric: draft.metric,
      operator: draft.operator,
      threshold,
      severity: draft.severity,
      cooldown_minutes: cooldown,
      enabled: Boolean(draft.enabled),
      node_id: draft.node_id ? draft.node_id : null,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-white/5 bg-white/[0.02] p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-metric`}>
            Metric
          </label>
          <select
            id={`${idPrefix}-metric`}
            value={draft.metric}
            onChange={(e) => set('metric', e.target.value)}
            className={FIELD_CLASS}
          >
            {METRICS.map((m) => (
              <option key={m.value} value={m.value} className="bg-navy-900">
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-operator`}>
            Condition
          </label>
          <select
            id={`${idPrefix}-operator`}
            value={draft.operator}
            onChange={(e) => set('operator', e.target.value)}
            className={FIELD_CLASS}
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value} className="bg-navy-900">
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-threshold`}>
            Threshold
          </label>
          <input
            id={`${idPrefix}-threshold`}
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.threshold}
            onChange={(e) => set('threshold', e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-severity`}>
            Severity
          </label>
          <select
            id={`${idPrefix}-severity`}
            value={draft.severity}
            onChange={(e) => set('severity', e.target.value)}
            className={FIELD_CLASS}
          >
            {SEVERITIES.map((s) => (
              <option key={s.value} value={s.value} className="bg-navy-900">
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-cooldown`}>
            Cooldown (minutes)
          </label>
          <input
            id={`${idPrefix}-cooldown`}
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.cooldown_minutes}
            onChange={(e) => set('cooldown_minutes', e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-node`}>
            Applies to
          </label>
          <select
            id={`${idPrefix}-node`}
            value={draft.node_id ?? ''}
            onChange={(e) => set('node_id', e.target.value)}
            className={FIELD_CLASS}
          >
            <option value="" className="bg-navy-900">
              All nodes
            </option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id} className="bg-navy-900">
                {n.name || n.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Toggle label="Rule enabled" checked={Boolean(draft.enabled)} onChange={(v) => set('enabled', v)} />

      {error && <p className="rounded-lg bg-rose-400/10 p-2.5 text-xs text-rose-300">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isBusy}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-navy-950 transition-colors hover:bg-sky-300 disabled:opacity-50 focus-ring"
        >
          {isBusy && <Loader2 size={14} className="animate-spin" />}
          Save rule
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-[44px] items-center justify-center rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-ring"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Alert rules editor. The evaluate-alerts Edge Function reads these rows on
 * every incoming reading, so this list is literally the only thing that makes
 * an alert fire.
 */
export default function AlertRules() {
  const [rules, setRules] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAlertRules(), fetchNodes()])
      .then(([ruleRows, nodeRows]) => {
        if (cancelled) return;
        setRules(ruleRows);
        setNodes(nodeRows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load alert rules.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(values) {
    setBusyId('new');
    setError('');
    try {
      const created = await createAlertRule(values);
      if (created) setRules((prev) => [created, ...prev]);
      setIsCreating(false);
    } catch (err) {
      setError(err.message || 'Could not create the rule.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(id, patch) {
    setBusyId(id);
    setError('');
    try {
      const updated = await updateAlertRule(id, patch);
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...(updated ?? patch) } : r)));
      setEditingId(null);
    } catch (err) {
      setError(err.message || 'Could not update the rule.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id) {
    setBusyId(id);
    setError('');
    try {
      await deleteAlertRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err.message || 'Could not delete the rule.');
    } finally {
      setBusyId(null);
    }
  }

  function nodeLabel(nodeId) {
    if (!nodeId) return 'All nodes';
    return nodes.find((n) => n.id === nodeId)?.name || nodeId;
  }

  return (
    <section className="rounded-2xl border border-white/5 bg-navy-900 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-white">Alert rules</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Evaluated against every incoming reading.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsCreating((v) => !v);
            setEditingId(null);
          }}
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-400/20 focus-ring"
        >
          {isCreating ? <X size={13} /> : <Plus size={13} />}
          {isCreating ? 'Close' : 'New rule'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-400/10 p-3 text-xs text-rose-300" role="status" aria-live="polite">
          {error}
        </p>
      )}

      {isCreating && (
        <div className="mt-4">
          <RuleForm
            idPrefix="new-rule"
            initial={EMPTY_RULE}
            nodes={nodes}
            isBusy={busyId === 'new'}
            onCancel={() => setIsCreating(false)}
            onSubmit={handleCreate}
          />
        </div>
      )}

      {isLoading ? (
        <div className="mt-5 animate-pulse space-y-2" aria-hidden="true">
          <div className="h-14 rounded-lg bg-white/5" />
          <div className="h-14 rounded-lg bg-white/5" />
          <div className="h-14 rounded-lg bg-white/5" />
        </div>
      ) : rules.length === 0 ? (
        <div className="mt-5 flex flex-col items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-10 text-center">
          <BellOff size={22} className="text-slate-700" />
          <p className="text-sm font-medium text-slate-300">No alert rules yet</p>
          <p className="max-w-sm text-xs text-slate-500">
            Without at least one rule, no alert will ever fire — readings are recorded but nothing
            is ever flagged. Create a rule to start being notified.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {rules.map((rule) => {
            const cfg = getSeverityConfig(rule.severity);
            const Icon = cfg.icon;
            const isEditing = editingId === rule.id;

            if (isEditing) {
              return (
                <li key={rule.id}>
                  <RuleForm
                    idPrefix={`rule-${rule.id}`}
                    initial={{ ...rule, node_id: rule.node_id ?? '' }}
                    nodes={nodes}
                    isBusy={busyId === rule.id}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(values) => handleUpdate(rule.id, values)}
                  />
                </li>
              );
            }

            return (
              <li
                key={rule.id}
                className={cn(
                  'rounded-lg border px-3 py-3 transition-colors',
                  cfg.border,
                  cfg.bg,
                  !rule.enabled && 'opacity-60'
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <Icon size={15} className={cn('mt-0.5 shrink-0', cfg.color)} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">
                        {labelFor(METRICS, rule.metric)} {labelFor(OPERATORS, rule.operator)}{' '}
                        {rule.threshold}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        <span className={cn('font-medium capitalize', cfg.color)}>{rule.severity}</span>
                        {' \u00b7 '}
                        {nodeLabel(rule.node_id)}
                        {' \u00b7 '}
                        {rule.cooldown_minutes}m cooldown
                        {!rule.enabled && ' \u00b7 disabled'}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(rule.enabled)}
                      aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule for ${labelFor(METRICS, rule.metric)}`}
                      disabled={busyId === rule.id}
                      onClick={() => handleUpdate(rule.id, { enabled: !rule.enabled })}
                      className={cn(
                        'relative h-7 w-12 shrink-0 rounded-full transition-colors focus-ring',
                        rule.enabled ? 'bg-sky-400' : 'bg-white/10'
                      )}
                    >
                      <span
                        className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all"
                        style={{ left: rule.enabled ? '22px' : '2px' }}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(rule.id);
                        setIsCreating(false);
                        setConfirmDeleteId(null);
                      }}
                      aria-label={`Edit rule for ${labelFor(METRICS, rule.metric)}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus-ring"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(rule.id)}
                      aria-label={`Delete rule for ${labelFor(METRICS, rule.metric)}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-400/10 hover:text-rose-300 focus-ring"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {confirmDeleteId === rule.id && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-navy-950/60 px-3 py-2.5">
                    <p className="text-xs text-slate-300">
                      Delete this rule? Alerts for it will stop firing immediately.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(rule.id)}
                        disabled={busyId === rule.id}
                        className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-rose-400/15 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-400/25 disabled:opacity-50 focus-ring"
                      >
                        {busyId === rule.id && <Loader2 size={12} className="animate-spin" />}
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[44px] rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 focus-ring"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
