'use client';

import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Reusable connection status badge. Surfaces the `connectionStatus` from
 * useSensorNodes (or any string) in a consistent pill format across the
 * Dashboard and any future live views.
 *
 * Part of Phase C4: connection resilience. Gives users a clear visual
 * indicator of whether live data is flowing.
 */
const STATUS_CONFIG = {
  connected: { icon: Wifi, color: 'bg-emerald-400/10 text-emerald-400', label: 'Live' },
  connecting: { icon: Loader2, color: 'bg-amber-400/10 text-amber-400', label: 'Connecting', spin: true },
  reconnecting: { icon: Loader2, color: 'bg-amber-400/10 text-amber-400', label: 'Reconnecting', spin: true },
  disconnected: { icon: WifiOff, color: 'bg-rose-400/10 text-rose-400', label: 'Offline' },
  error: { icon: WifiOff, color: 'bg-rose-400/10 text-rose-400', label: 'Error' },
  offline: { icon: WifiOff, color: 'bg-white/5 text-slate-500', label: 'Offline' },
  idle: { icon: WifiOff, color: 'bg-white/5 text-slate-500', label: 'Idle' },
};

export default function ConnectionBadge({ status = 'idle', mode, className }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  const Icon = config.icon;
  const modeLabel = mode === 'realtime' ? 'Realtime' : mode === 'offline' ? '' : mode;

  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
        config.color,
        className
      )}
      title={`Live data: ${config.label}${modeLabel ? ` (${modeLabel})` : ''}`}
    >
      <Icon size={11} className={cn(config.spin && 'animate-spin')} />
      {config.label}
    </span>
  );
}
