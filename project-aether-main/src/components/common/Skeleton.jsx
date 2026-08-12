import { cn } from '../../utils/cn';

export default function Skeleton({ className }) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-white/5', className)}
      aria-hidden="true"
    />
  );
}

export function SensorCardSkeleton() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-navy-900 p-5">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="mt-2 h-3 w-20" />
      <Skeleton className="mt-3 h-10 w-full rounded-lg" />
      <div className="mt-4 grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full rounded-full" />
        ))}
      </div>
      <Skeleton className="mt-4 h-3 w-full" />
    </div>
  );
}
