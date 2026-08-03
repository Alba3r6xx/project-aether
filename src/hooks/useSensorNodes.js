'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNodes, subscribeToReadings } from '../services/historyService';
import { IS_SUPABASE_CONFIGURED } from '../services/supabaseClient';

/**
 * Loads sensor nodes and keeps them fresh.
 *
 * LIVE DATA VIA SUPABASE REALTIME (closes G7): the browser no longer
 * connects to HiveMQ directly. The ingest-mqtt Edge Function is the sole
 * MQTT subscriber and writer to sensor_readings; this hook subscribes to
 * INSERT events on that table via Supabase Realtime, so live readings
 * stream in without mqtt.js or MQTT credentials in the browser bundle.
 *
 * Modes:
 *  - 'realtime' — Supabase configured, live readings stream in (the
 *     normal production mode).
 *  - 'offline' — Supabase not configured; no live subscription, nodes
 *     stay empty, the dashboard shows an honest empty state.
 *
 * Components consuming this hook (Dashboard, SensorCard, etc.) don't need
 * to know or care which mode is active - `nodes` always has the same shape.
 *
 * Marked 'use client' because it uses Supabase Realtime (browser-only).
 */
export function useSensorNodes() {
  const [nodes, setNodes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const mode = IS_SUPABASE_CONFIGURED ? 'realtime' : 'offline';
  const isLive = mode === 'realtime';

  // Initial load - always starts from a Supabase fetch so the UI has
  // something to show before the first live message arrives (and so it
  // works even when no live transport is configured, as long as Supabase
  // has historical rows).
  useEffect(() => {
    let mounted = true;
    fetchNodes().then((data) => {
      if (!mounted) return;
      setNodes(data);
      setIsLoading(false);
      setLastRefreshed(new Date());
      if (!isLive) setConnectionStatus('offline');
    });
    return () => {
      mounted = false;
      refreshMountedRef.current = false;
    };
  }, [isLive]);

  // AUDIT H2: guard against state updates after unmount in refresh.
  const refreshMountedRef = useRef(true);
  const refresh = useCallback(async () => {
    refreshMountedRef.current = true;
    setIsRefreshing(true);
    try {
      const updated = await fetchNodes();
      if (!refreshMountedRef.current) return;
      setNodes(updated);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Failed to refresh nodes:', err);
    } finally {
      if (refreshMountedRef.current) setIsRefreshing(false);
    }
  }, []);

  const mergeNodes = useCallback((incomingNodes) => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      incomingNodes.forEach((n) => byId.set(n.id, { ...byId.get(n.id), ...n }));
      return Array.from(byId.values());
    });
    setLastRefreshed(new Date());
  }, []);

  // Live readings via Supabase Realtime (closes G7): the browser
  // subscribes to INSERT events on sensor_readings. The ingest-mqtt
  // Edge Function is the sole writer; this hook just listens.
  // AUDIT H9: uses the subscribe status callback to track connected/
  // disconnected/error states instead of a setTimeout hack.
  useEffect(() => {
    if (mode !== 'realtime') return undefined;

    setConnectionStatus('connecting');

    let unsubscribe = () => {};
    subscribeToReadings(
      (node) => {
        mergeNodes([node]);
      },
      (status) => {
        setConnectionStatus(status);
      }
    ).then((fn) => { unsubscribe = fn; });

    return () => {
      unsubscribe();
    };
  }, [mode, mergeNodes]);

  return { nodes, isLoading, isRefreshing, lastRefreshed, refresh, isLive, mode, connectionStatus };
}
