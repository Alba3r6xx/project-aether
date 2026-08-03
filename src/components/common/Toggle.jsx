'use client';

import { motion } from 'framer-motion';
import { cn } from '../../utils/cn';

/**
 * Shared switch control used by the Settings page and the per-device
 * settings card. Extracted so both render an identical, accessible switch
 * (role="switch" + aria-checked) instead of drifting copies.
 *
 * The wrapper is a <label> so the whole row is a 44px+ touch target.
 */
export default function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <label
      className={cn(
        'flex min-h-[44px] cursor-pointer items-center justify-between gap-4 py-3',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm text-slate-300">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors focus-ring',
          checked ? 'bg-sky-400' : 'bg-white/10'
        )}
      >
        <motion.span
          layout
          className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow"
          style={{ left: checked ? '22px' : '2px' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </button>
    </label>
  );
}
