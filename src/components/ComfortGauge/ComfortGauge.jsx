'use client';

import { useEffect, useState } from 'react';
import * as Icons from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Circular gauge for individual metrics. Enterprise version: compact ring
 * with icon, animated value, and unit. Uses viewBox for responsive scaling.
 *
 * Client Component because it uses requestAnimationFrame for count-up.
 */
export default function ComfortGauge({
  label,
  value,
  unit,
  min = 0,
  max = 100,
  color = 'var(--color-accent-green)',
  iconName,
  size = 80,
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const Icon = iconName ? Icons[iconName] : null;
  const hasValue = value !== null && value !== undefined && !Number.isNaN(Number(value));

  useEffect(() => {
    if (!hasValue) return;
    let frame;
    const target = Number(value);
    const duration = 600;
    const start = performance.now();
    const startVal = displayValue;
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(startVal + (target - startVal) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const radius = size / 2 - 7;
  const circumference = 2 * Math.PI * radius;
  const ratio = hasValue ? Math.max(0, Math.min(1, (Number(value) - min) / (max - min))) : 0;
  const dashOffset = circumference * (1 - ratio);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative aspect-square w-full max-w-[80px]"
        role="progressbar"
        aria-valuenow={hasValue ? Math.round(Number(value)) : 0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={`${label}: ${hasValue ? Math.round(Number(value)) : 'N/A'}${unit || ''}`}
      >
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={5}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={hasValue ? color : 'rgba(255,255,255,0.15)'}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.4s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {Icon && <Icon size={14} className={cn('mb-0.5 opacity-70', hasValue ? 'text-slate-300' : 'text-slate-600')} />}
          <span className={cn('text-base font-bold leading-none', hasValue ? 'text-white' : 'text-slate-600')}>
            {hasValue ? Math.round(displayValue) : '--'}
          </span>
          {unit && <span className="mt-0.5 text-[9px] font-medium text-slate-500">{unit}</span>}
        </div>
      </div>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  );
}
