'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, History, LineChart, Settings } from 'lucide-react';
import { cn } from '../../utils/cn';

const ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/history', label: 'History', icon: History },
  { href: '/analytics', label: 'Analytics', icon: LineChart },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Mobile bottom navigation bar. Shows on screens below the lg breakpoint
 * where the Sidebar is hidden. Provides touch-friendly (44px+) navigation
 * between the main app sections.
 *
 * Fixed to the bottom of the viewport with safe-area inset support for
 * notched devices. Uses backdrop blur for a modern iOS/Android feel.
 */
export default function MobileNav() {
  const pathname = usePathname();

  // Only show on authenticated app routes, not the landing page
  const appRoutes = ['/dashboard', '/history', '/analytics', '/settings'];
  const isAppRoute = appRoutes.some((r) => pathname === r || pathname?.startsWith(r + '/'));
  if (!isAppRoute) return null;

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-navy-900/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch justify-around">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-2 transition-colors focus-ring',
                  isActive ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                <Icon size={20} className={cn(isActive && 'drop-shadow-[0_0_4px_rgba(56,189,248,0.4)]')} />
                <span className="text-[11px] font-medium leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
