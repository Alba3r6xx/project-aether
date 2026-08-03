import Link from 'next/link';
import { LayoutDashboard, History, LineChart, Settings, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn';

const ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/history', label: 'History', icon: History },
  { href: '/analytics', label: 'Analytics', icon: LineChart },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Secondary in-app navigation rail, shown alongside the top Navbar on
 * History/Settings pages where a quick-switch between sections is useful.
 * The primary Dashboard screens intentionally stay full-width (no sidebar)
 * to match the Figma layout exactly.
 *
 * Server Component - no client hooks needed (the active state is passed in
 * as a prop by the page that renders it).
 */
export default function Sidebar({ active }) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-white/5 bg-navy-950 px-3 py-6 lg:block">
      <p className="px-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        Navigate
      </p>
      <nav className="mt-3 flex flex-col gap-1">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-ring',
                isActive
                  ? 'bg-white/5 text-white'
                  : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
              )}
            >
              <span className="flex items-center gap-2.5">
                <Icon size={16} />
                {item.label}
              </span>
              {isActive && <ChevronRight size={14} />}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
