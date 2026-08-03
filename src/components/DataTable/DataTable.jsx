'use client';

import { useMemo, useState, useEffect, useRef, memo } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { cn } from '../../utils/cn';

/**
 * Generic sensor readings table. `variant="mini"` renders the compact
 * "Recent History" list (with an inline sparkline per metric) seen on the
 * Dashboard card; `variant="full"` renders a full table with a header row,
 * used on the History page.
 *
 * The mini variant's sparkline data comes from the `series` prop (a map of
 * metric key -> [{ time, value }, ...] fetched from Supabase), NOT from
 * mock data. If a metric has no series, the sparkline area is left blank.
 *
 * PERFORMANCE (Phase D3): the full variant uses window-based virtualization
 * — only the visible rows (plus a small overscan buffer) are rendered in
 * the DOM, so the table stays fast even with thousands of rows. The mini
 * variant's sparklines are memoized so they don't re-render on every parent
 * update.
 *
 * Client Component: the mini variant uses Recharts ResponsiveContainer.
 */
const COLUMNS = [
  { key: 'temperature', label: 'Temperature', unit: '\u00b0C', color: 'text-emerald-400', stroke: '#34d399' },
  { key: 'humidity', label: 'Humidity', unit: '%', color: 'text-sky-400', stroke: '#38bdf8' },
  { key: 'airQuality', label: 'Air Quality', unit: 'AQI', color: 'text-orange-400', stroke: '#fb923c' },
  { key: 'luminosity', label: 'Luminosity', unit: 'LUX', color: 'text-amber-400', stroke: '#facc15' },
];

const ROW_HEIGHT = 45;
const VISIBLE_ROWS = 50;
const OVERSCAN = 10;

const MiniSparkline = memo(function MiniSparkline({ data, stroke }) {
  if (!data || data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={1.75}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
});

export default function DataTable({ rows = [], variant = 'full', series = {} }) {
  const columns = COLUMNS;

  // Virtualization state for the full variant.
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (variant !== 'full' || !scrollRef.current) return undefined;
    const el = scrollRef.current;

    function handleScroll() {
      setScrollTop(el.scrollTop);
    }

    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
    el.addEventListener('scroll', handleScroll, { passive: true });

    const ro = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      ro.disconnect();
    };
  }, [variant]);

  const virtualized = useMemo(() => {
    if (variant !== 'full') return null;

    const totalRows = rows.length;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
    );
    const visibleRows = rows.slice(startIndex, endIndex);
    const topPadding = startIndex * ROW_HEIGHT;
    const bottomPadding = (totalRows - endIndex) * ROW_HEIGHT;

    return { visibleRows, topPadding, bottomPadding, startIndex, totalRows };
  }, [rows, scrollTop, viewportHeight, variant]);

  if (variant === 'mini') {
    return (
      <div className="card-hover rounded-xl border border-white/[0.06] bg-navy-900 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-white">Metric Trends</h3>
          <span className="text-xs text-slate-600">Last 12 hours</span>
        </div>
        <ul className="mt-3 flex flex-col gap-1">
          {columns.map((col) => {
            const data = series[col.key] ?? [];
            const currentValue = rows[0]?.[col.key];
            const hasValue = currentValue !== null && currentValue !== undefined;
            return (
              <li
                key={col.key}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.02]"
              >
                <span className="w-20 shrink-0 text-xs font-medium text-slate-400 sm:w-24">{col.label}</span>
                <span className="h-7 flex-1 min-w-0">
                  <MiniSparkline data={data} stroke={col.stroke} />
                </span>
                <span className={cn(
                  'w-16 shrink-0 text-right text-xs font-semibold tabular-nums',
                  hasValue ? col.color : 'text-slate-600'
                )}>
                  {hasValue ? currentValue : '--'}
                  <span className="ml-0.5 text-xs font-normal text-slate-600">{col.unit}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-2xl border border-white/5 bg-navy-900 shadow-lg shadow-black/20"
      style={{ maxHeight: '70vh' }}
    >
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-navy-900">
          <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-slate-400">
            <th className="px-5 py-3 font-medium">Date</th>
            {columns.map((col) => (
              <th key={col.key} className="px-5 py-3 font-medium">
                {col.label} ({col.unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {virtualized && virtualized.totalRows > 0 && (
            <>
              {virtualized.topPadding > 0 && (
                <tr style={{ height: virtualized.topPadding }}>
                  <td colSpan={columns.length + 1} style={{ padding: 0, border: 0 }} />
                </tr>
              )}
              {virtualized.visibleRows.map((row, i) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-white/5 last:border-0',
                    (virtualized.startIndex + i) % 2 === 1 && 'bg-white/[0.015]'
                  )}
                  style={{ height: ROW_HEIGHT }}
                >
                  <td className="px-5 py-3 text-slate-300">{row.date}</td>
                  {columns.map((col) => (
                    <td key={col.key} className={cn('px-5 py-3 font-medium', col.color)}>
                      {row[col.key] ?? '--'}
                    </td>
                  ))}
                </tr>
              ))}
              {virtualized.bottomPadding > 0 && (
                <tr style={{ height: virtualized.bottomPadding }}>
                  <td colSpan={columns.length + 1} style={{ padding: 0, border: 0 }} />
                </tr>
              )}
            </>
          )}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-5 py-10 text-center text-xs text-slate-500">
                No readings recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
