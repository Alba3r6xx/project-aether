#!/usr/bin/env node
/**
 * Local MQTT → Supabase bridge.
 *
 * The ingest-mqtt Edge Function is designed as a long-running MQTT
 * subscriber, but Supabase Edge Functions time out. This script runs
 * locally and does the same job: subscribes to HiveMQ, parses ESP32
 * payloads, and inserts rows into sensor_readings.
 *
 * Run: node scripts/mqtt-bridge.js
 * Stop: Ctrl+C
 */

const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

// --- Config (from .env / .env.local) ---
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const MQTT_URL = process.env.MQTT_BROKER_URL || 'mqtts://9268686336de4c5a9a2008b31bea5823.s1.eu.hivemq.cloud:8883';
const MQTT_USER = process.env.MQTT_USERNAME || 'AetherOS';
const MQTT_PASS = process.env.MQTT_PASSWORD || 'AetherOS';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'aether/+/telemetry';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check .env.local');
  process.exit(1);
}

// --- Supabase client (service_role, bypasses RLS) ---
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- Comfort index (mirrors ingest-mqtt Edge Function) ---
const cToF = (c) => c * 1.8 + 32;
const fToC = (f) => (f - 32) * 0.55555;

function computeHeatIndex(tempC, humidity) {
  const tempF = cToF(tempC);
  const h = Math.max(0, Math.min(100, humidity));
  let hiF;
  if (tempF <= 80) {
    hiF = 0.5 * (tempF + 61.0 + (tempF - 68.0) * 1.2 + h * 0.094);
  } else {
    hiF = -42.379 + 2.04901523 * tempF + 10.14333127 * h
      - 0.22475541 * tempF * h - 0.00683783 * tempF * tempF
      - 0.05481717 * h * h + 0.00122874 * tempF * tempF * h
      + 0.00085282 * tempF * h * h - 0.00000199 * tempF * tempF * h * h;
    if (h < 13 && tempF >= 80 && tempF <= 112) {
      hiF -= ((13 - h) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17);
    } else if (h > 85 && tempF >= 80 && tempF <= 87) {
      hiF += ((h - 85) / 10) * ((87 - tempF) / 5);
    }
  }
  return fToC(hiF);
}

function getComfortStatus(heatIndexC, airQuality) {
  if (heatIndexC > 29 || heatIndexC < 18 || airQuality > 2000) return 'POOR';
  if (heatIndexC >= 20 && heatIndexC <= 26 && airQuality < 1000) return 'OPTIMAL';
  return 'FAIR';
}

// --- Node org_id cache ---
const nodeOrgCache = new Map();

async function getOrgIdForNode(nodeId) {
  if (nodeOrgCache.has(nodeId)) return nodeOrgCache.get(nodeId);
  const { data: node } = await supabase
    .from('nodes')
    .select('org_id')
    .eq('id', nodeId)
    .maybeSingle();
  const orgId = node?.org_id ?? null;
  nodeOrgCache.set(nodeId, orgId);
  // Refresh cache every 5 minutes
  setTimeout(() => nodeOrgCache.delete(nodeId), 5 * 60 * 1000);
  return orgId;
}

// --- Main ---
let messageCount = 0;
let errorCount = 0;

console.log(`[bridge] Connecting to ${MQTT_URL} (topic: ${MQTT_TOPIC})`);

const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
  protocolVersion: 5,
  reconnectPeriod: 3000,
  connectTimeout: 15000,
  clientId: `aether-bridge-${Date.now().toString(36)}`,
});

client.on('connect', () => {
  console.log('[bridge] Connected to broker, subscribing...');
  client.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
    if (err) {
      console.error('[bridge] Subscribe failed:', err.message);
    } else {
      console.log(`[bridge] Subscribed to ${MQTT_TOPIC}`);
    }
  });
});

client.on('reconnect', () => console.log('[bridge] Reconnecting...'));
client.on('error', (err) => console.error('[bridge] Error:', err.message));
client.on('close', () => console.log('[bridge] Connection closed'));

client.on('message', async (topic, payloadBuffer) => {
  try {
    const payload = JSON.parse(payloadBuffer.toString());
    const temperature = payload.temperature ?? payload.temp;
    const humidity = payload.humidity;
    // air_quality is CO2 ppm (400-50000), NOT a 0-100 percentage
    const airQuality = payload.airQuality;
    // The firmware sends "light" as a raw ADC value (0-4095). Store it
    // directly as luminosity — the dashboard can interpret the raw value.
    // The previous conversion (light/4095)*3000 was producing wrong values.
    const luminosity = payload.luminosity ?? payload.light;

    // Parse node_id from topic: aether/<node_id>/telemetry
    const segments = topic.split('/');
    const nodeId = segments.length >= 3 ? segments[1] : 'node-01';

    // Validate ranges
    const clamp = (val, min, max) => {
      if (val === undefined || val === null || typeof val !== 'number' || isNaN(val)) return undefined;
      if (val < min || val > max) return undefined;
      return val;
    };

    const validTemp = clamp(temperature, -50, 100);
    const validHum = clamp(humidity, 0, 100);
    const validAq = clamp(airQuality, 0, 50000);
    const validLum = clamp(luminosity, 0, 100000);

    // Compute heat index and comfort
    let heatIndex, comfortStatus;
    if (validTemp !== undefined && validHum !== undefined) {
      heatIndex = Math.round(computeHeatIndex(validTemp, validHum) * 10) / 10;
      if (validAq !== undefined) {
        comfortStatus = getComfortStatus(heatIndex, validAq);
      }
    }

    // Look up org_id
    const orgId = await getOrgIdForNode(nodeId);
    if (!orgId) {
      console.warn(`[bridge] Node ${nodeId} not claimed, skipping`);
      return;
    }

    const row = {
      node_id: nodeId,
      org_id: orgId,
      temperature: validTemp,
      humidity: validHum,
      heat_index: heatIndex,
      air_quality: validAq,
      luminosity: validLum,
      comfort_index: heatIndex,
      comfort_status: comfortStatus,
    };

    const { error } = await supabase.from('sensor_readings').insert(row);

    if (error) {
      console.error(`[bridge] Insert failed: ${error.message}`);
      errorCount++;
    } else {
      messageCount++;
      if (messageCount % 50 === 0) {
        console.log(`[bridge] Ingested ${messageCount} messages (${errorCount} errors)`);
      }
    }
  } catch (err) {
    console.error(`[bridge] Malformed payload on ${topic}:`, err.message);
    errorCount++;
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n[bridge] Shutting down. Total: ${messageCount} messages, ${errorCount} errors.`);
  client.end();
  process.exit(0);
});
