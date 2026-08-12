import { createServerSupabaseClient } from './supabaseServer';

/**
 * Server-side history + alerts + nodes + metric-series fetchers, used by
 * Server Components for SSR initial data. NO MOCK DATA - reads from
 * Supabase. Returns empty arrays / null when Supabase isn't configured so
 * SSR renders honest empty states instead of 500ing.
 *
 * Mirrors the client historyService.js shape so SSR and CSR stay
 * consistent.
 */

function notConfiguredWarning(fnName) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `[server] ${fnName}: Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env. Returning empty.`
    );
  }
}

// AUDIT M14: gate verbose error logging behind development mode.
const logError = (msg, err) => {
  if (process.env.NODE_ENV === 'development') {
    console.error(msg, err);
  }
};

export async function fetchDailyHistoryServer() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    notConfiguredWarning('fetchDailyHistoryServer');
    return [];
  }

  const { data, error } = await supabase
    .from('sensor_readings')
    .select('id, node_id, recorded_at, temperature, humidity, heat_index, air_quality, luminosity, comfort_index, comfort_status')
    .order('recorded_at', { ascending: true })
    .limit(14);

  if (error) {
    logError('Server: failed to load sensor_readings:', error);
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

export async function fetchAlertsServer() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    notConfiguredWarning('fetchAlertsServer');
    return [];
  }

  const { data, error } = await supabase
    .from('alerts')
    .select('id, node_id, severity, title, description, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    logError('Server: failed to load alerts:', error);
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

export async function fetchLatestReadingServer() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    notConfiguredWarning('fetchLatestReadingServer');
    return null;
  }

  const { data, error } = await supabase
    .from('sensor_readings')
    .select('id, node_id, recorded_at, temperature, humidity, heat_index, air_quality, luminosity, comfort_index, comfort_status')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    logError('Server: failed to load latest reading:', error);
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

const METRIC_COLUMN = {
  temperature: 'temperature',
  humidity: 'humidity',
  airQuality: 'air_quality',
  luminosity: 'luminosity',
  comfortIndex: 'comfort_index',
};

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

export async function fetchMetricSeriesServer(metric, { nodeId, rangeHours = 24 } = {}) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    notConfiguredWarning('fetchMetricSeriesServer');
    return [];
  }

  const column = METRIC_COLUMN[metric];
  if (!column) {
    logError(`[server] fetchMetricSeriesServer: unknown metric "${metric}"`);
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
    logError(`Server: failed to load ${metric} series from ${table}:`, error);
    return [];
  }

  return data
    .filter((row) => {
      const v = row[selectCol];
      // AUDIT M9: filter out null, undefined, AND NaN to prevent chart gaps.
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

export async function fetchNodesServer() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    notConfiguredWarning('fetchNodesServer');
    return [];
  }

  // Always fetch from the nodes table first — claimed nodes with no readings
  // must still appear (otherwise they're invisible in the UI).
  const { data: nodesData, error: nodesError } = await supabase
    .from('nodes')
    .select('id, name, room, floor, location, firmware_version, claimed_at')
    .order('claimed_at', { ascending: true });

  if (nodesError) {
    logError('Server: failed to load nodes:', nodesError);
    return [];
  }

  if (!nodesData || nodesData.length === 0) {
    return [];
  }

  // Build the base node list from the nodes table.
  const byId = new Map();
  for (const node of nodesData) {
    byId.set(node.id, {
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
    });
  }

  // Enrich with latest readings via the RPC (single query, not N+1).
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'get_latest_readings_per_node',
    {}
  );

  if (!rpcError && rpcData) {
    for (const row of rpcData) {
      const node = byId.get(row.node_id);
      if (node) {
        node.comfort = row.comfort_status;
        node.temperature = row.temperature;
        node.humidity = row.humidity;
        node.airQuality = row.air_quality;
        node.luminosity = row.luminosity;
        node.lastUpdated = row.recorded_at;
      }
    }
  }

  return Array.from(byId.values());
}

export async function fetchServerUser() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
