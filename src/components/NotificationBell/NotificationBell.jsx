'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, X } from 'lucide-react';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
} from '../../services/historyService';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../utils/cn';

/**
 * Notification bell icon with unread count badge and a dropdown panel
 * showing recent notifications. Subscribes to Supabase Realtime so new
 * notifications (from the evaluate-alerts Edge Function) appear live
 * without a page refresh.
 *
 * Part of Phase C2: notification delivery. Renders nothing when Supabase
 * isn't configured or the user isn't signed in.
 */
export default function NotificationBell() {
  const { isSupabaseConfigured, isAuthenticated, user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !isAuthenticated) return;

    fetchUnreadNotificationCount().then(setUnreadCount).catch(() => setUnreadCount(0));
    fetchNotifications({ limit: 10 }).then(setNotifications).catch(() => setNotifications([]));

    let unsubscribe = () => {};
    subscribeToNotifications((notification) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 10));
      setUnreadCount((c) => c + 1);
    }).then((fn) => { unsubscribe = fn; });

    return () => unsubscribe();
  }, [isSupabaseConfigured, isAuthenticated, user?.id]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    // AUDIT H11: close the dropdown on Escape key for keyboard accessibility.
    function handleKeyDown(e) {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        // Return focus to the bell button so keyboard users aren't stranded.
        const btn = dropdownRef.current?.querySelector('button');
        btn?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function handleMarkRead(id) {
    await markNotificationRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  if (!isSupabaseConfigured || !isAuthenticated) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white focus-ring"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-xs font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-white/10 bg-navy-900 shadow-xl shadow-black/40"
          >
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <p className="text-sm font-semibold text-white">Notifications</p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  aria-label="Mark all notifications as read"
                  className="flex min-h-[36px] items-center gap-1 rounded text-xs text-sky-400 hover:text-sky-300 focus-ring"
                >
                  <Check size={12} />
                  Mark all read
                </button>
              )}
            </div>

            <ul className="max-h-80 overflow-y-auto" aria-live="polite" aria-atomic="false">
              {notifications.length === 0 && (
                <li className="py-8 text-center text-xs text-slate-500">
                  No notifications yet.
                </li>
              )}
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'flex gap-3 border-b border-white/5 px-4 py-3 last:border-0 transition-colors hover:bg-white/[0.02]',
                    !n.read && 'bg-sky-400/[0.03]'
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.read ? 'bg-slate-600' : 'bg-sky-400'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white">{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-400 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">{n.time}</p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(n.id)}
                      aria-label="Mark as read"
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:text-white focus-ring"
                    >
                      <X size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
