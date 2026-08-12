'use client';

import { motion } from 'framer-motion';
import { RefreshCw, Wifi, WifiOff, MapPin, Clock } from 'lucide-react';
import StatusCard from '../StatusCard/StatusCard';
import ComfortGauge from '../ComfortGauge/ComfortGauge';
import { METRIC_CONFIG } from '../../data/constants';
import { cn } from '../../utils/cn';

const METRIC_KEYS = ['temperature', 'humidity', 'airQuality', 'luminosity'];

/**
 * Enterprise sensor node card. Compact, data-dense layout:
 *   Header: node name, location, live badge, refresh
 *   Status: slim comfort bar
 *   Metrics: 4 responsive gauges
 *   Footer: last updated timestamp
 */
export default function SensorCard({ node, onRefresh, isRefreshing }) {
  const isLive = node.status === 'live';

  const lastUpdated = node.lastUpdated
    ? new Date(node.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="card-hover flex flex-col rounded-xl border border-white/[0.06] bg-navy-900 p-4 sm:p-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-sm font-semibold text-white">{node.name}</h3>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
                isLive ? 'bg-emerald-400/10 text-emerald-400' : 'bg-rose-400/10 text-rose-400'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', isLive ? 'bg-emerald-400 animate-live-pulse' : 'bg-rose-400')} />
              {isLive ? 'LIVE' : 'OFFLINE'}
            </span>
          </div>
          {node.room && node.room !== 'Unassigned' && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <MapPin size={10} />
              {node.room}{node.floor ? ` \u00b7 ${node.floor}` : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh sensor readings"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/5 hover:text-white focus-ring"
        >
          <RefreshCw size={13} className={cn(isRefreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Comfort status bar */}
      <div className="mt-3">
        <StatusCard level={node.comfort} />
      </div>

      {/* Metric gauges */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2">
        {METRIC_KEYS.map((key) => {
          const cfg = METRIC_CONFIG[key];
          return (
            <ComfortGauge
              key={key}
              label={cfg.label}
              value={node[key]}
              unit={cfg.unit}
              min={cfg.min}
              max={cfg.max}
              color={cfg.color}
              iconName={cfg.icon}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-white/[0.04] pt-3">
        <span className="flex items-center gap-1 text-xs text-slate-600">
          <Clock size={10} />
          {lastUpdated ? `Updated ${lastUpdated}` : 'No data yet'}
        </span>
        <span className="font-mono text-xs text-slate-600">{node.id}</span>
      </div>
    </motion.div>
  );
}
