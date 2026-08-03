'use client';

import { motion } from 'framer-motion';
import { AlertOctagon, AlertTriangle, Info, BellOff } from 'lucide-react';
import { cn } from '../../utils/cn';

const SEVERITY_CONFIG = {
  critical: { icon: AlertOctagon, color: 'text-rose-400', bg: 'bg-rose-400/10', border: 'border-rose-400/15' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/15' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/15' },
};

function getSeverityConfig(severity) {
  return SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
}

/**
 * Enterprise alerts panel. Shows recent alerts with severity icons,
 * timestamps, and clear visual hierarchy. Compact for dashboard sidebar.
 */
export default function AlertsPanel({ alerts = [] }) {
  return (
    <div className="card-hover flex flex-col rounded-xl border border-white/[0.06] bg-navy-900 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-white">Active Alerts</h3>
        {alerts.length > 0 && (
          <span className="rounded bg-rose-400/10 px-1.5 py-0.5 text-xs font-semibold text-rose-400">
            {alerts.length}
          </span>
        )}
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {alerts.map((alert, i) => {
          const cfg = getSeverityConfig(alert.severity);
          const Icon = cfg.icon;
          return (
            <motion.li
              key={alert.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors hover:bg-white/[0.02]',
                cfg.border,
                cfg.bg
              )}
            >
              <Icon size={15} className={cn('mt-0.5 shrink-0', cfg.color)} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white">{alert.title}</p>
                {alert.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{alert.description}</p>
                )}
                {alert.time && (
                  <p className="mt-1 text-xs text-slate-600">{alert.time}</p>
                )}
              </div>
            </motion.li>
          );
        })}

        {alerts.length === 0 && (
          <li className="flex flex-col items-center gap-2 py-8 text-center">
            <BellOff size={20} className="text-slate-700" />
            <p className="text-xs text-slate-600">All systems normal</p>
            <p className="text-xs text-slate-700">No active alerts</p>
          </li>
        )}
      </ul>
    </div>
  );
}
