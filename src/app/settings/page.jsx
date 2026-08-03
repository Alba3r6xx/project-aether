'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut, Mail, Plus, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import Navbar from '../../components/Navbar/Navbar';
import Sidebar from '../../components/Sidebar/Sidebar';
import Toggle from '../../components/common/Toggle';
import DeviceSettings from '../../components/DeviceSettings/DeviceSettings';
import AlertRules from '../../components/AlertRules/AlertRules';
import { fetchNodes, fetchNotificationPreferences, saveNotificationPreferences } from '../../services/historyService';
import { supabase } from '../../services/supabaseClient';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';

export default function SettingsPage() {
  const { user, signOut, isSupabaseConfigured } = useAuth();
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    weeklyReport: false,
  });
  const [nodes, setNodes] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState('');

  // Add-node form state (B3: node provisioning & claim flow)
  const [showAddForm, setShowAddForm] = useState(false);
  const [claimForm, setClaimForm] = useState({ nodeId: '', name: '', room: '' });
  const [claimStatus, setClaimStatus] = useState({ type: '', message: '' });
  const [isClaiming, setIsClaiming] = useState(false);

  useEffect(() => {
    fetchNodes()
      .then((rows) => {
        setNodes(rows);
        // Default the device-settings card to the first node so the section is
        // never empty when at least one node exists.
        setSelectedNodeId((current) => (current || rows[0]?.id) ?? '');
      })
      .catch((err) => console.error('Failed to fetch nodes:', err));
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? nodes[0] ?? null;

  // Load notification preferences from DB (C2: makes toggles real, closes G13)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    fetchNotificationPreferences()
      .then((prefs) => {
        setNotifications({
          email: prefs.email,
          push: prefs.push,
          weeklyReport: prefs.weekly_report,
        });
      })
      .catch((err) => console.error('Failed to fetch notification preferences:', err));
  }, [isSupabaseConfigured]);

  // Save notification preferences to DB when toggles change.
  // BUG FIX: debounce the save so rapid toggles don't fire multiple
  // concurrent requests that could race (last write should win).
  const saveTimerRef = useRef(null);

  function handleNotificationChange(key, value) {
    setNotifications((prev) => {
      const next = { ...prev, [key]: value };
      if (isSupabaseConfigured) {
        // Clear any pending save and schedule a new one 500ms later.
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveNotificationPreferences({
            email: next.email,
            push: next.push,
            weekly_report: next.weeklyReport,
          }).catch((err) => console.error('Failed to save notification preferences:', err));
        }, 500);
      }
      return next;
    });
  }

  async function handleClaimNode(e) {
    e.preventDefault();
    setClaimStatus({ type: '', message: '' });
    setIsClaiming(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setClaimStatus({ type: 'error', message: 'You must be signed in to claim a node.' });
        setIsClaiming(false);
        return;
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/claim-node`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodeId: claimForm.nodeId,
          name: claimForm.name,
          room: claimForm.room,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setClaimStatus({ type: 'error', message: data.error || 'Failed to claim node.' });
      } else {
        setClaimStatus({ type: 'success', message: `Node "${claimForm.name}" claimed successfully.` });
        setClaimForm({ nodeId: '', name: '', room: '' });
        setShowAddForm(false);
        // Refresh the node list.
        fetchNodes().then(setNodes);
      }
    } catch (err) {
      setClaimStatus({ type: 'error', message: err.message || 'Network error.' });
    } finally {
      setIsClaiming(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-950">
      <Navbar tone="dark" />
      <div className="mx-auto flex max-w-7xl">
        <Sidebar active="/settings" />
        <main id="main-content" className="min-w-0 flex-1 px-4 py-6 pb-20 sm:px-8 sm:py-8 lg:pb-8">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Preferences</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">Settings</h1>

          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {isSupabaseConfigured && (
              <section className="rounded-2xl border border-white/5 bg-navy-900 p-6">
                <h2 className="font-display text-base font-semibold text-white">Account</h2>
                <div className="mt-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                    {(user?.user_metadata?.full_name || user?.email || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {user?.user_metadata?.full_name || 'Signed in user'}
                    </p>
                    <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                      <Mail size={11} />
                      {user?.email}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="mt-4 flex items-center gap-1.5 rounded-lg bg-white/5 px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-ring"
                >
                  <LogOut size={13} />
                  Sign out
                </button>
              </section>
            )}

            <section className="rounded-2xl border border-white/5 bg-navy-900 p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-white">Registered nodes</h2>
                {isSupabaseConfigured && (
                  <button
                    type="button"
                    onClick={() => setShowAddForm((v) => !v)}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-400/20 focus-ring"
                  >
                    <Plus size={13} />
                    Add node
                  </button>
                )}
              </div>

              {showAddForm && (
                <form onSubmit={handleClaimNode} className="mt-4 space-y-3 rounded-lg border border-white/5 bg-white/[0.02] p-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">Node ID</label>
                    <input
                      type="text"
                      required
                      value={claimForm.nodeId}
                      onChange={(e) => setClaimForm((f) => ({ ...f, nodeId: e.target.value }))}
                      placeholder="e.g. node-01"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus-ring"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">Name</label>
                    <input
                      type="text"
                      required
                      value={claimForm.name}
                      onChange={(e) => setClaimForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Living Room Sensor"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus-ring"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-300">Room (optional)</label>
                    <input
                      type="text"
                      value={claimForm.room}
                      onChange={(e) => setClaimForm((f) => ({ ...f, room: e.target.value }))}
                      placeholder="e.g. Living Room"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus-ring"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isClaiming}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-navy-950 transition-colors hover:bg-sky-300 disabled:opacity-50 focus-ring"
                  >
                    {isClaiming && <Loader2 size={14} className="animate-spin" />}
                    Claim node
                  </button>
                </form>
              )}

              {claimStatus.message && (
                <div
                  className={cn(
                    'mt-3 flex items-center gap-2 rounded-lg p-3 text-xs',
                    claimStatus.type === 'error' ? 'bg-rose-400/10 text-rose-300' : 'bg-emerald-400/10 text-emerald-300'
                  )}
                >
                  {claimStatus.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                  {claimStatus.message}
                </div>
              )}

              <ul className="mt-3 divide-y divide-white/5">
                {nodes.map((node) => (
                  <li key={node.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-200">{node.name}</p>
                      <p className="text-xs text-slate-500">{node.room}</p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium',
                        node.status === 'live'
                          ? 'bg-emerald-400/10 text-emerald-300'
                          : 'bg-rose-400/10 text-rose-300'
                      )}
                    >
                      {node.status === 'live' ? 'Live' : 'Low'}
                    </span>
                  </li>
                ))}
                {nodes.length === 0 && (
                  <li className="py-6 text-center text-xs text-slate-500">
                    No nodes have been claimed yet. Click &ldquo;Add node&rdquo; to claim one.
                  </li>
                )}
              </ul>
            </section>

            <section className="rounded-2xl border border-white/5 bg-navy-900 p-6">
              <h2 className="font-display text-base font-semibold text-white">Notifications</h2>
              <div className="mt-1 divide-y divide-white/5">
                <Toggle
                  label="Email alerts"
                  checked={notifications.email}
                  onChange={(v) => handleNotificationChange('email', v)}
                />
                <Toggle
                  label="Push notifications"
                  checked={notifications.push}
                  onChange={(v) => handleNotificationChange('push', v)}
                />
                <Toggle
                  label="Weekly summary report"
                  checked={notifications.weeklyReport}
                  onChange={(v) => handleNotificationChange('weeklyReport', v)}
                />
              </div>
            </section>

            {/* Per-device configuration (migration 0008 downlink) */}
            <div className="lg:col-span-2">
              {nodes.length > 1 && (
                <div className="mb-4 rounded-2xl border border-white/5 bg-navy-900 p-6">
                  <label
                    htmlFor="device-node-select"
                    className="mb-1 block text-xs font-medium text-slate-300"
                  >
                    Configure device
                  </label>
                  <select
                    id="device-node-select"
                    value={selectedNode?.id ?? ''}
                    onChange={(e) => setSelectedNodeId(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus-ring sm:max-w-sm"
                  >
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id} className="bg-navy-900">
                        {node.name || node.id}
                        {node.room && node.room !== 'Unassigned' ? ` \u00b7 ${node.room}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <DeviceSettings node={selectedNode} />
            </div>

            <div className="lg:col-span-2">
              <AlertRules />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
