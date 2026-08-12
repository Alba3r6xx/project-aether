'use client';

/**
 * Sensor data service layer (client-only).
 *
 * NO MOCK DATA. NO DIRECT MQTT CONNECTION. The browser gets live readings
 * via Supabase Realtime (see subscribeToReadings in historyService.js),
 * NOT by connecting to HiveMQ itself. The ingest-mqtt Edge Function is the
 * sole MQTT subscriber and writer to sensor_readings (closes G7).
 *
 * This module now only provides the initial node fetch + refresh helpers.
 * The live subscription lives in useSensorNodes.js via subscribeToReadings.
 *
 * Marked 'use client' because it imports from historyService.js which
 * uses the browser Supabase client.
 */
import { fetchNodes } from './historyService';

/**
 * Fetches the current set of sensor nodes from Supabase (one row per
 * distinct node_id in sensor_readings, each carrying its latest reading).
 * Returns [] when Supabase isn't configured - the dashboard then shows an
 * empty state until live Realtime messages arrive.
 */
export async function fetchSensorNodes() {
  return fetchNodes();
}

export async function fetchSensorNode(nodeId) {
  const nodes = await fetchNodes();
  return nodes.find((n) => n.id === nodeId) ?? null;
}

/**
 * Re-fetches the current node set from Supabase. In live (Realtime) mode
 * this is mostly a visual affordance since Realtime keeps data current,
 * but it gives the Dashboard's refresh button something real to do.
 */
export async function refreshSensorNodes() {
  return fetchNodes();
}
