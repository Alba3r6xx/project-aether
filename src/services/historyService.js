'use client';

/**
 * History + alerts + nodes persistence layer (client side).
 *
 * Live sensor readings arrive over HiveMQ/MQTT (see sensorService.js) but
 * MQTT itself doesn't remember anything - nothing is "historical" until
 * something writes it down. That's Supabase's job here.
 *
 * NO MOCK DATA: every function reads from Supabase. If Supabase isn't
 * configured (no env vars), functions return empty arrays / null and log
 * a warning so the UI renders honest empty states instead of fake data.
 * Configure NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in
 * .env to get real data.
 *
 * The server-side equivalents live in historyServiceServer.js and are used
 * by Server Components for SSR initial data.
 */
import { supabase, IS_SUPABASE_CONFIGURED } from './supabaseClient';

function notConfiguredWarning(fnName) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `${fnName}: Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env to load real data. Returning empty.`
    );
  }
}

// AUDIT M14: gate verbose error logging behind development mode so
// production logs aren't flooded with Supabase error details.
const logError = (msg, err) => {
  if (process.env.NODE_ENV === 'development') {
    console.error(msg, err);
  }
};

export async function fetchDailyHistory() {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchDailyHistory');
    return [];
  }

  const { data, error } = await supabase
    .from('sensor_readings')
    .select('id, node_id, recorded_at, temperature, humidity, heat_index, air_quality, luminosity, comfort_index, comfort_status')
    .order('recorded_at', { ascending: true })
    .limit(14);

  if (error) {
    logError('Failed to load sensor_readings from Supabase:', error);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    node: row.node_id,
    date: row.recorded_at?.slice(0, 10),
    temperature: row.temperature,
    humidity: row.humidity,
    heatIndex: row.heat_index,
    airQuality: row.air_quality,
    luminosity: row.luminosity,
    comfortIndex: row.comfort_index,
    comfortStatus: row.comfort_status,
  }));
}

export async function fetchAlerts() {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchAlerts');
    return [];
  }

  const { data, error } = await supabase
    .from('alerts')
    .select('id, node_id, severity, title, description, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    logError('Failed to load alerts from Supabase:', error);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    node: row.node_id,
    severity: row.severity,
    title: row.title,
    description: row.description,
    time: new Date(row.created_at).toLocaleString(),
  }));
}

/**
 * Subscribes to live INSERT events on the `alerts` table via Supabase
 * Realtime. Calls `onInsert(newAlert)` every time a new alert row is
 * committed. Returns an unsubscribe function.
 *
 * Closes gap G5: the AlertsPanel was one-shot (fetched once on mount,
 * never updated). Now new alerts stream in without a page refresh.
 *
 * No-ops (returns a no-op unsubscribe) when Supabase isn't configured.
 */
export async function subscribeToAlerts(onInsert) {
  if (!IS_SUPABASE_CONFIGURED) return () => {};

  // SECURITY: filter by org_id so users only receive their own org's alerts.
  // Without this, Realtime broadcasts ALL inserts to ALL subscribers.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return () => {};
  const { data: orgId } = await supabase.rpc('get_user_org_id', {
    p_user_id: userData.user.id,
  });
  if (!orgId) return () => {};

  const channel = supabase
    .channel('alerts-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'alerts', filter: `org_id=eq.${orgId}` },
      (payload) => {
        const row = payload.new;
        onInsert({
          id: row.id,
          node: row.node_id,
          severity: row.severity,
          title: row.title,
          description: row.description,
          time: new Date(row.created_at).toLocaleString(),
        });
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/**
 * Subscribes to live INSERT events on the `sensor_readings` table via
 * Supabase Realtime. Calls `onInsert(node)` every time a new reading
 * row is committed by the ingest-mqtt Edge Function. Returns an
 * unsubscribe function.
 *
 * This replaces the browser-side mqtt.js subscription (closes G7):
 * the browser no longer connects to HiveMQ directly, so MQTT credentials
 * are never shipped to the client. The Edge Function is the sole MQTT
 * subscriber and writer; the browser just listens for new rows.
 *
 * The callback receives a node-shaped object matching what useSensorNodes
 * expects (id, temperature, humidity, airQuality, luminosity, comfort,
 * lastUpdated).
 *
 * No-ops (returns a no-op unsubscribe) when Supabase isn't configured.
 */
export async function subscribeToReadings(onInsert, onStatusChange) {
  if (!IS_SUPABASE_CONFIGURED) return () => {};

  // SECURITY: filter by org_id so users only receive their own org's readings.
  // Without this, Realtime broadcasts ALL inserts to ALL subscribers —
  // a user in Org A would see live data from Org B's sensors.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return () => {};
  const { data: orgId } = await supabase.rpc('get_user_org_id', {
    p_user_id: userData.user.id,
  });
  if (!orgId) return () => {};

  const channel = supabase
    .channel('sensor-readings-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sensor_readings', filter: `org_id=eq.${orgId}` },
      (payload) => {
        const row = payload.new;
        // Only the reading itself — no name/room/battery/wifi. useSensorNodes
        // merges this over the node fetched from the `nodes` table, so sending
        // placeholder metadata here would overwrite the real name and room
        // the moment the first live reading arrived.
        onInsert({
          id: row.node_id,
          status: 'live',
          comfort: row.comfort_status,
          temperature: row.temperature,
          humidity: row.humidity,
          airQuality: row.air_quality,
          luminosity: row.luminosity,
          lastUpdated: row.recorded_at,
        });
      }
    )
    .subscribe((status) => {
      // AUDIT H9: handle Realtime connection status changes so the UI
      // reflects disconnects and reconnects.
      if (onStatusChange) {
        if (status === 'SUBSCRIBED') onStatusChange('connected');
        else if (status === 'CLOSED') onStatusChange('disconnected');
        else if (status === 'CHANNEL_ERROR') onStatusChange('error');
        else if (status === 'TIMED_OUT') onStatusChange('disconnected');
      }
    });

  return () => supabase.removeChannel(channel);
}

export async function fetchLatestReading() {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchLatestReading');
    return null;
  }

  const { data, error } = await supabase
    .from('sensor_readings')
    .select('id, node_id, recorded_at, temperature, humidity, heat_index, air_quality, luminosity, comfort_index, comfort_status')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    logError('Failed to load latest reading from Supabase:', error);
    return null;
  }

  return {
    id: data.id,
    node: data.node_id,
    date: data.recorded_at?.slice(0, 10),
    temperature: data.temperature,
    humidity: data.humidity,
    heatIndex: data.heat_index,
    airQuality: data.air_quality,
    luminosity: data.luminosity,
    comfortIndex: data.comfort_index,
    comfortStatus: data.comfort_status,
  };
}

/**
 * Fetches a time series for a single metric, shaped as
 * `[{ time: "HH:MM", value: number }, ...]` for Recharts. `metric` is
 * one of: temperature | humidity | airQuality | luminosity | comfortIndex
 * (mapped to the snake_case column names in Supabase).
 *
 * `rangeHours` controls how far back to look (default 24h). The function
 * automatically picks the right table based on the range (Phase D1):
 *   - < 24h  → sensor_readings (raw, 5s granularity)
 *   - 1-30d  → hourly_readings (hourly avg, 1 point/hour)
 *   - > 30d  → daily_readings (daily avg, 1 point/day)
 * This keeps queries fast even when months of raw data exist, and the
 * 30-day retention policy on raw rows doesn't affect long-range charts.
 */
const METRIC_COLUMN = {
  temperature: 'temperature',
  humidity: 'humidity',
  airQuality: 'air_quality',
  luminosity: 'luminosity',
  comfortIndex: 'comfort_index',
};

// Aggregate tables use avg_<metric> for most metrics.
const AGG_COLUMN = {
  temperature: 'avg_temperature',
  humidity: 'avg_humidity',
  airQuality: 'avg_air_quality',
  luminosity: 'avg_luminosity',
  comfortIndex: 'avg_heat_index',
};

function pickTableForRange(rangeHours) {
  if (rangeHours <= 24) return { table: 'sensor_readings', timeCol: 'recorded_at', isRaw: true };
  if (rangeHours <= 24 * 30) return { table: 'hourly_readings', timeCol: 'hour_bucket', isRaw: false };
  return { table: 'daily_readings', timeCol: 'day_bucket', isRaw: false };
}

export async function fetchMetricSeries(metric, { nodeId, rangeHours = 24 } = {}) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchMetricSeries');
    return [];
  }

  const column = METRIC_COLUMN[metric];
  if (!column) {
    logError(`fetchMetricSeries: unknown metric "${metric}"`);
    return [];
  }

  const { table, timeCol, isRaw } = pickTableForRange(rangeHours);
  const selectCol = isRaw ? column : AGG_COLUMN[metric];
  const since = new Date(Date.now() - rangeHours * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from(table)
    .select(`${timeCol}, ${selectCol}`)
    .order(timeCol, { ascending: true });

  if (nodeId) query = query.eq('node_id', nodeId);
  query = query.gte(timeCol, since).limit(500);

  const { data, error } = await query;

  if (error) {
    logError(`Failed to load ${metric} series from ${table}:`, error);
    return [];
  }

  return data
    .filter((row) => {
      const v = row[selectCol];
      // AUDIT M9: filter out null, undefined, AND NaN to prevent gaps in charts.
      return v !== null && v !== undefined && !Number.isNaN(Number(v));
    })
    .map((row) => {
      const d = new Date(row[timeCol]);
      let label;
      if (isRaw) {
        label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      } else if (rangeHours <= 24 * 30) {
        label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      } else {
        label = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      }
      return { time: label, value: row[selectCol] };
    });
}

/**
 * Fetches the list of registered nodes from the `nodes` table (Phase B2/B3).
 * Each node is enriched with its latest reading from `sensor_readings` so
 * the Dashboard and Settings pages have current values to display.
 *
 * Falls back to deriving nodes from sensor_readings (distinct node_ids)
 * if the `nodes` table is empty or doesn't exist yet, so the transition
 * from the old approach to the new one is seamless.
 */
export async function fetchNodes() {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchNodes');
    return [];
  }

  // Get the current user's org_id so we can scope the query (RLS requires
  // org_id on every reading; the RPC needs it as a parameter).
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data: orgId } = await supabase.rpc('get_user_org_id', {
    p_user_id: userData.user.id,
  });
  if (!orgId) return [];

  // Use the RPC function for a single-query latest reading per node
  // (AUDIT C9: was N+1 — one query per node. Now uses DISTINCT ON via RPC).
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'get_latest_readings_per_node',
    { p_org_id: orgId }
  );

  if (!rpcError && rpcData && rpcData.length > 0) {
    return rpcData.map((row) => ({
      id: row.node_id,
      name: row.node_name,
      room: row.room || 'Unassigned',
      floor: row.floor,
      location: row.location,
      firmwareVersion: row.firmware_version,
      status: 'live',
      comfort: row.comfort_status,
      temperature: row.temperature,
      humidity: row.humidity,
      airQuality: row.air_quality,
      luminosity: row.luminosity,
      battery: null,
      wifi: null,
      lastUpdated: row.recorded_at,
    }));
  }

  // Fallback: try the nodes table without readings (for when no readings
  // exist yet but nodes have been claimed).
  const { data: nodesData, error: nodesError } = await supabase
    .from('nodes')
    .select('id, name, room, floor, location, firmware_version, claimed_at')
    .order('claimed_at', { ascending: true });

  if (!nodesError && nodesData && nodesData.length > 0) {
    return nodesData.map((node) => ({
      id: node.id,
      name: node.name,
      room: node.room || 'Unassigned',
      floor: node.floor,
      location: node.location,
      firmwareVersion: node.firmware_version,
      status: 'live',
      comfort: null,
      temperature: null,
      humidity: null,
      airQuality: null,
      luminosity: null,
      battery: null,
      wifi: null,
      lastUpdated: node.claimed_at,
    }));
  }

  // Final fallback: derive nodes from sensor_readings (pre-B2 behavior).
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('node_id, recorded_at, temperature, humidity, heat_index, air_quality, luminosity, comfort_index, comfort_status')
    .order('recorded_at', { ascending: false })
    .limit(500);

  if (error) {
    logError('Failed to load nodes from Supabase:', error);
    return [];
  }

  const byId = new Map();
  for (const row of data) {
    if (byId.has(row.node_id)) continue;
    byId.set(row.node_id, {
      id: row.node_id,
      name: `ESP32 - ${row.node_id}`,
      room: 'Unassigned',
      status: 'live',
      comfort: row.comfort_status,
      temperature: row.temperature,
      humidity: row.humidity,
      airQuality: row.air_quality,
      luminosity: row.luminosity,
      battery: null,
      wifi: null,
      lastUpdated: row.recorded_at,
    });
  }

  return Array.from(byId.values());
}

/**
 * Writes one sensor reading to Supabase. Call this from wherever readings
 * land in the app (e.g. the MQTT onMessage handler) once you want browser-
 * side logging instead of a server-side Edge Function. Silently no-ops if
 * Supabase isn't configured.
 *
 * Computes the Steadman heat index and comfort status from the raw
 * temperature/humidity/airQuality values using the same formula as the
 * firmware (PDF §5.0), so the stored comfort_index and comfort_status
 * match what the ESP32 OLED displays.
 */
export async function recordSensorReading(nodeId, reading) {
  if (!IS_SUPABASE_CONFIGURED) return null;

  const { evaluateComfort } = await import('../data/constants');
  const { heatIndex, comfortStatus } = evaluateComfort({
    temperature: reading.temperature,
    humidity: reading.humidity,
    airQuality: reading.airQuality,
  });

  const { error } = await supabase.from('sensor_readings').insert({
    node_id: nodeId,
    temperature: reading.temperature,
    humidity: reading.humidity,
    heat_index: heatIndex,
    air_quality: reading.airQuality,
    luminosity: reading.luminosity,
    comfort_index: heatIndex,
    comfort_status: comfortStatus,
  });

  if (error) logError('Failed to record sensor reading to Supabase:', error);
}

// ---------------------------------------------------------------------------
// Notifications (Phase C2: in-app toast/bell with unread count)
// ---------------------------------------------------------------------------

/**
 * Fetches the current user's notifications (most recent first).
 * BUG FIX: filter by user_id so users only see their own notifications.
 */
export async function fetchNotifications({ limit = 20 } = {}) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchNotifications');
    return [];
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, read, created_at')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logError('Failed to load notifications:', error);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    read: row.read,
    time: new Date(row.created_at).toLocaleString(),
  }));
}

/**
 * Fetches the count of unread notifications for the bell icon badge.
 * BUG FIX: filter by user_id.
 */
export async function fetchUnreadNotificationCount() {
  if (!IS_SUPABASE_CONFIGURED) return 0;

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return 0;

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userData.user.id)
    .eq('read', false);

  if (error) {
    logError('Failed to count unread notifications:', error);
    return 0;
  }

  return count ?? 0;
}

/**
 * Marks a notification as read.
 * BUG FIX: also filter by user_id to prevent modifying other users' notifications.
 */
export async function markNotificationRead(id) {
  if (!IS_SUPABASE_CONFIGURED) return;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userData.user.id);
  if (error) logError('Failed to mark notification read:', error);
}

/**
 * Marks all notifications as read for the current user.
 * BUG FIX: filter by user_id.
 */
export async function markAllNotificationsRead() {
  if (!IS_SUPABASE_CONFIGURED) return;
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('read', false)
    .eq('user_id', userData.user.id);
  if (error) logError('Failed to mark all notifications read:', error);
}

/**
 * Subscribes to live INSERT events on the `notifications` table via
 * Supabase Realtime. Calls `onInsert(notification)` every time a new
 * notification is created (e.g. by the evaluate-alerts Edge Function).
 */
export async function subscribeToNotifications(onInsert) {
  if (!IS_SUPABASE_CONFIGURED) return () => {};

  // BUG FIX: filter by user_id so users only receive their own notifications
  // via Realtime (not every notification in the table).
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return () => {};

  const channel = supabase
    .channel('notifications-changes')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      },
      (payload) => {
        const row = payload.new;
        onInsert({
          id: row.id,
          title: row.title,
          body: row.body,
          read: row.read,
          time: new Date(row.created_at).toLocaleString(),
        });
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ---------------------------------------------------------------------------
// Notification preferences (Phase C2: makes Settings toggles real, closes G13)
// ---------------------------------------------------------------------------

/**
 * Fetches the current user's notification preferences.
 * Returns defaults if no row exists yet.
 */
export async function fetchNotificationPreferences() {
  if (!IS_SUPABASE_CONFIGURED) {
    return { email: true, push: true, weekly_report: false };
  }

  // BUG FIX: filter by user_id so users only see their own preferences.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { email: true, push: true, weekly_report: false };

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('email, push, weekly_report')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (error || !data) {
    return { email: true, push: true, weekly_report: false };
  }

  return data;
}

/**
 * Upserts the current user's notification preferences.
 */
export async function saveNotificationPreferences(prefs) {
  if (!IS_SUPABASE_CONFIGURED) return;

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;

  // Look up the user's org_id so notification_preferences has a valid org_id
  // (required after migration 0006 makes it NOT NULL).
  const { data: orgData } = await supabase.rpc('get_user_org_id', {
    p_user_id: userData.user.id,
  });

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({
      user_id: userData.user.id,
      org_id: orgData || null,
      email: prefs.email,
      push: prefs.push,
      weekly_report: prefs.weekly_report,
      updated_at: new Date().toISOString(),
    });

  if (error) logError('Failed to save notification preferences:', error);
}

// ---------------------------------------------------------------------------
// Per-device settings (migration 0008: downlink config to the ESP32)
//
// `device_settings` holds the DESIRED configuration for a node. The
// publish-config Edge Function serialises it onto aether/<node_id>/config
// with retain=true, so a device that is offline still picks the config up
// the moment it reconnects. `reported_config` / `reported_at` are written
// by service_role only and describe what the hardware actually applied.
// ---------------------------------------------------------------------------

/**
 * Fetches the device_settings row for a node.
 * Returns null when Supabase isn't configured or the row doesn't exist yet.
 */
export async function fetchDeviceSettings(nodeId) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchDeviceSettings');
    return null;
  }

  const { data, error } = await supabase
    .from('device_settings')
    .select(
      'node_id, org_id, co2_warn_ppm, co2_hazard_ppm, buzzer_enabled, quiet_hours_start, quiet_hours_end, timezone_offset_minutes, display_page_seconds, reported_config, reported_at, updated_at'
    )
    .eq('node_id', nodeId)
    .maybeSingle();

  if (error || !data) {
    logError('Failed to load device settings from Supabase:', error);
    return null;
  }

  return data;
}

/**
 * Updates a node's desired configuration and returns the updated row.
 * Returns null when Supabase isn't configured or the write failed.
 */
export async function saveDeviceSettings(nodeId, patch) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('saveDeviceSettings');
    return null;
  }

  const { data, error } = await supabase
    .from('device_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('node_id', nodeId)
    .select(
      'node_id, org_id, co2_warn_ppm, co2_hazard_ppm, buzzer_enabled, quiet_hours_start, quiet_hours_end, timezone_offset_minutes, display_page_seconds, reported_config, reported_at, updated_at'
    )
    .maybeSingle();

  if (error) {
    logError('Failed to save device settings to Supabase:', error);
    throw new Error(error.message || 'Failed to save device settings.');
  }

  return data;
}

/**
 * Asks the publish-config Edge Function to push the node's saved config to
 * MQTT. `wifi` is an optional array of { ssid, password } (max 3) that is
 * passed straight through to the device and NEVER persisted in Postgres —
 * omitted from the request body entirely when not supplied.
 *
 * Throws with the server's error message on a non-OK response so the caller
 * can distinguish "saved but not delivered" from "saved and applied".
 */
export async function publishDeviceConfig(nodeId, wifi) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('publishDeviceConfig');
    return null;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to sync settings to a device.');
  }

  const body = { nodeId };
  if (wifi !== undefined && wifi !== null) body.wifi = wifi;

  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/publish-config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message = payload?.error || 'Failed to publish config to the device.';
    logError('Failed to publish device config:', message);
    throw new Error(message);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Alert rules (migration 0003: thresholds the evaluate-alerts function reads)
// ---------------------------------------------------------------------------

/**
 * Fetches every alert rule visible to the current user's org, newest first.
 * RLS already scopes reads to the caller's org; the explicit org_id filter is
 * defense-in-depth and matches how saveNotificationPreferences resolves the org.
 */
export async function fetchAlertRules() {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('fetchAlertRules');
    return [];
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data: orgId } = await supabase.rpc('get_user_org_id', {
    p_user_id: userData.user.id,
  });

  let query = supabase
    .from('alert_rules')
    .select('id, org_id, node_id, metric, operator, threshold, severity, cooldown_minutes, enabled, created_at')
    .order('created_at', { ascending: false });

  if (orgId) query = query.eq('org_id', orgId);

  const { data, error } = await query;

  if (error) {
    logError('Failed to load alert rules from Supabase:', error);
    return [];
  }

  return data ?? [];
}

/**
 * Inserts a new alert rule for the current user's org and returns it.
 */
export async function createAlertRule(rule) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('createAlertRule');
    return null;
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('You must be signed in to create alert rules.');

  // org_id is NOT NULL on alert_rules after migration 0006.
  const { data: orgId } = await supabase.rpc('get_user_org_id', {
    p_user_id: userData.user.id,
  });

  const { data, error } = await supabase
    .from('alert_rules')
    .insert({
      org_id: rule.org_id ?? orgId ?? null,
      node_id: rule.node_id ?? null,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      severity: rule.severity,
      cooldown_minutes: rule.cooldown_minutes,
      enabled: rule.enabled ?? true,
    })
    .select('id, org_id, node_id, metric, operator, threshold, severity, cooldown_minutes, enabled, created_at')
    .maybeSingle();

  if (error) {
    logError('Failed to create alert rule:', error);
    throw new Error(error.message || 'Failed to create alert rule.');
  }

  return data;
}

/**
 * Updates an alert rule by id and returns the updated row.
 */
export async function updateAlertRule(id, patch) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('updateAlertRule');
    return null;
  }

  const { data, error } = await supabase
    .from('alert_rules')
    .update(patch)
    .eq('id', id)
    .select('id, org_id, node_id, metric, operator, threshold, severity, cooldown_minutes, enabled, created_at')
    .maybeSingle();

  if (error) {
    logError('Failed to update alert rule:', error);
    throw new Error(error.message || 'Failed to update alert rule.');
  }

  return data;
}

/**
 * Deletes an alert rule by id.
 */
export async function deleteAlertRule(id) {
  if (!IS_SUPABASE_CONFIGURED) {
    notConfiguredWarning('deleteAlertRule');
    return;
  }

  const { error } = await supabase.from('alert_rules').delete().eq('id', id);

  if (error) {
    logError('Failed to delete alert rule:', error);
    throw new Error(error.message || 'Failed to delete alert rule.');
  }
}
