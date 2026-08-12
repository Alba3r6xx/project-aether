'use client';

import { CheckCircle2, AlertTriangle, AlertOctagon, HelpCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { COMFORT_LEVELS } from '../../data/constants';
import { cn } from '../../utils/cn';

const ICONS = {
  GOOD: CheckCircle2,
  FAIR: AlertTriangle,
  POOR: AlertOctagon,
  HAZARD: AlertOctagon,
};

const STYLES = {
  GOOD: {
    bar: 'bg-emerald-400',
    text: 'text-emerald-400',
    bg: 'bg-emerald-400/[0.07]',
    border: 'border-emerald-400/20',
  },
  FAIR: {
    bar: 'bg-amber-400',
    text: 'text-amber-400',
    bg: 'bg-amber-400/[0.07]',
    border: 'border-amber-400/20',
  },
  POOR: {
    bar: 'bg-rose-400',
    text: 'text-rose-400',
    bg: 'bg-rose-400/[0.07]',
    border: 'border-rose-400/20',
  },
  HAZARD: {
    bar: 'bg-red-500',
    text: 'text-red-500',
    bg: 'bg-red-500/[0.09]',
    border: 'border-red-500/30',
  },
};

/**
 * Slim comfort status bar. Enterprise version: compact horizontal bar
 * with icon, status label, and message — no gradient, just clean accent.
 */
export default function StatusCard({ level }) {
  const info = COMFORT_LEVELS[level];
  const validLevel = ['GOOD', 'FAIR', 'POOR', 'HAZARD'].includes(level);
  const Icon = validLevel ? ICONS[level] : HelpCircle;
  const styles = validLevel ? STYLES[level] : STYLES.FAIR;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3.5 py-2.5',
        styles.bg,
        styles.border
      )}
    >
      <Icon size={16} className={cn('shrink-0', styles.text)} />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-semibold', styles.text)}>
            {validLevel ? info.label : 'No Data'}
          </span>
        </div>
        <p className="hidden truncate text-xs text-slate-400 sm:block">
          {validLevel ? info.message : 'Waiting for sensor data...'}
        </p>
      </div>
    </motion.div>
  );
}
