'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, AlertTriangle } from 'lucide-react';
import { IS_SUPABASE_CONFIGURED } from '../../services/supabaseClient';

/**
 * Network status banner (closes G12). Shows a sticky banner at the top of
 * the screen when the browser goes offline, and auto-hides when it comes
 * back online. Purely client-side — uses the browser's `online`/`offline`
 * events.
 *
 * AUDIT H8: also polls the /api/health endpoint every 30s when Supabase is
 * configured, and shows a degraded banner if the database is unreachable
 * (so users know data may be stale instead of seeing empty states with no
 * explanation).
 *
 * Render once near the root of the app (it's position: fixed so it floats
 * above everything).
 */
export default function NetworkBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const [dbStatus, setDbStatus] = useState('unknown');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(navigator.onLine);

    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // AUDIT H8: poll the health endpoint when Supabase is configured so we
  // can surface database connectivity issues to the user.
  useEffect(() => {
    if (!IS_SUPABASE_CONFIGURED) return undefined;

    let cancelled = false;

    async function checkHealth() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (cancelled) return;
        if (res.ok) {
          setDbStatus('healthy');
        } else {
          setDbStatus('unhealthy');
        }
      } catch {
        if (!cancelled) setDbStatus('unreachable');
      }
    }

    checkHealth();
    const interval = setInterval(checkHealth, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const showOffline = !isOnline;
  const showDbError = isOnline && IS_SUPABASE_CONFIGURED && dbStatus === 'unhealthy';

  return (
    <AnimatePresence>
      {showOffline && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed left-0 right-0 top-0 z-[60] flex items-center justify-center gap-2 bg-rose-500 py-2 text-sm font-medium text-white"
        >
          <WifiOff size={14} />
          You&apos;re offline. Live updates are paused.
        </motion.div>
      )}
      {showDbError && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed left-0 right-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 py-2 text-sm font-medium text-white"
        >
          <AlertTriangle size={14} />
          Database connection issue. Data may be stale.
        </motion.div>
      )}
    </AnimatePresence>
  );
}
