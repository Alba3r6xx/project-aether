'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

const ChartTooltip = memo(function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-navy-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400">{label}</p>
      <p className="font-semibold text-white">
        {payload[0].value}
        {unit}
      </p>
    </div>
  );
});

/**
 * A single trend chart card: title, subtitle, responsive line chart and a
 * short summary sentence - used on the Dashboard (compact) and Analytics
 * pages (full width).
 *
 * PERFORMANCE (Phase D3): the chart is wrapped in memo() so it only
 * re-renders when its props (data, title, etc.) actually change, not on
 * every parent re-render (e.g. when a sibling component updates state).
 *
 * Client Component: Recharts' ResponsiveContainer reads container size at
 * runtime (no SSR sizing), so it must hydrate on the client.
 */
const ChartCard = memo(function ChartCard({
  title,
  subtitle,
  data,
  unit = '',
  color = 'var(--color-accent-blue)',
  summary,
  height = 220,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-white/5 bg-navy-900 p-4 shadow-lg shadow-black/20 sm:p-6"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Analytics</p>
      <h3 className="mt-1 font-display text-lg font-semibold text-white">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}

      <div
        className="mt-4 h-[180px] sm:h-[220px]"
        style={{ width: '100%' }}
        role="img"
        aria-label={`${title} chart${data.length ? `, ${data.length} data points` : ', no data'}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip content={<ChartTooltip unit={unit} />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {summary && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <p className="text-xs font-semibold text-slate-300">Summary</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{summary}</p>
        </div>
      )}
    </motion.div>
  );
});

export default ChartCard;
