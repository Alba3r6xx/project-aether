'use client';

import { motion } from 'framer-motion';
import { cn } from '../../utils/cn';

/**
 * KPI stat card for the dashboard top bar. Shows a single metric with
 * icon, label, value, and optional trend indicator.
 *
 * Enterprise pattern: compact, scannable, consistent width across the row.
 */
export default function StatCard({ icon: Icon, label, value, unit, accent = 'blue', trend, delay = 0 }) {
  const accentColors = {
    blue: 'text-blue-400 bg-blue-400/10',
    green: 'text-emerald-400 bg-emerald-400/10',
    amber: 'text-amber-400 bg-amber-400/10',
    red: 'text-rose-400 bg-rose-400/10',
    purple: 'text-purple-400 bg-purple-400/10',
    cyan: 'text-cyan-400 bg-cyan-400/10',
  };

  const trendColor = trend?.direction === 'up' ? 'text-emerald-400' : trend?.direction === 'down' ? 'text-rose-400' : 'text-slate-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="card-hover rounded-xl border border-white/[0.06] bg-navy-900 p-4"
    >
      <div className="flex items-center justify-between">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', accentColors[accent] || accentColors.blue)}>
          {Icon && <Icon size={17} />}
        </span>
        {trend && (
          <span className={cn('text-xs font-medium', trendColor)}>
            {trend.direction === 'up' ? '\u2191' : trend.direction === 'down' ? '\u2193' : '\u2013'} {trend.value}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold font-display text-white leading-none">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-400">{unit}</span>}
      </p>
      <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    </motion.div>
  );
}
