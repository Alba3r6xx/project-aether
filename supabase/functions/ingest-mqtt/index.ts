// ---------------------------------------------------------------------------
// Project Aether — Edge Function: ingest-mqtt
//
// The SOLE writer to the `sensor_readings` table (closes gap G2).
// Subscribes to HiveMQ over TCP MQTT (port 8883, TLS) using the
// service_role key, parses each ESP32 payload, computes the Steadman Heat
// Index + comfort status (aligned with the firmware's PDF §5.0 algorithm),
// and inserts one row per message.
//
// The browser NEVER writes to sensor_readings directly — this function is
// the single trusted writer, per roadmap principle #3 ("one writer, not
// many").
//
// ENV VARS (set in Supabase Dashboard > Edge Functions > ingest-mqtt > Secrets):
//   MQTT_BROKER_URL   - e.g. mqtts://xxxxxxxx.s1.eu.hivemq.cloud:8883
//   MQTT_USERNAME     - HiveMQ username
//   MQTT_PASSWORD     - HiveMQ password (server-only, never exposed to browser)
//   MQTT_TOPIC        - e.g. aether/sensors  (default: aether/sensors)
//   SUPABASE_URL      - https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY - service_role key (server-only)
//
// Deploy:
//   supabase functions deploy ingest-mqtt --no-verify-jwt
//
// The --no-verify-jwt flag is correct here: this function is a long-running
// MQTT subscriber, not an HTTP endpoint that serves browser requests. It
// runs continuously in the Supabase Edge Function runtime.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import mqtt from "https://esm.sh/mqtt@5.10.1";

// AUDIT H16/L10: structured logging helper.
function log(level: string, msg: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "ingest-mqtt", level, msg, ...meta }));
}

// ---------------------------------------------------------------------------
// Comfort Index — aligned with the ESP32 firmware (PDF §5.0)
// Mirrors src/data/constants.js exactly so server and client agree.
// ---------------------------------------------------------------------------

const cToF = (c: number) => c * 1.8 + 32;
const fToC = (f: number) => (f - 32) * 0.55555;

function computeHeatIndex(tempC: number, humidity: number): number {
  const tempF = cToF(tempC);
  const h = Math.max(0, Math.min(100, humidity));

  let hiF: number;
  if (tempF <= 80) {
    hiF = 0.5 * (tempF + 61.0 + (tempF - 68.0) * 1.2 + h * 0.094);
  } else {
    hiF =
      -42.379 +
      2.04901523 * tempF +
      10.14333127 * h -
      0.22475541 * tempF * h -
      0.00683783 * tempF * tempF -
      0.05481717 * h * h +
      0.00122874 * tempF * tempF * h +
      0.00085282 * tempF * h * h -
      0.00000199 * tempF * tempF * h * h;

    if (h < 13 && tempF >= 80 && tempF <= 112) {
      hiF -= ((13 - h) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17);
    } else if (h > 85 && tempF >= 80 && tempF <= 87) {
      hiF += ((h - 85) / 10) * ((87 - tempF) / 5);
    }
  }

  return fToC(hiF);
}

function getComfortStatus(heatIndexC: number, airQuality: number): string {
  // airQuality is CO2 ppm (400-50000). ASHRAE: >2000 = poor ventilation.
  if (heatIndexC > 29 || heatIndexC < 18 || airQuality > 2000) return "POOR";
  if (heatIndexC >= 20 && heatIndexC <= 26 && airQuality < 1000) return "OPTIMAL";
  return "FAIR";
}

// ---------------------------------------------------------------------------
// Payload normalization — maps the firmware's field names to our schema
// ---------------------------------------------------------------------------

interface SensorPayload {
  temp?: number;
  temperature?: number;
  humidity?: number;
  heatIndex?: number;
  airQuality?: number;
  light?: number;
  luminosity?: number;
  status?: string;
}

function normalizePayload(payload: SensorPayload, topic: string) {
  const temperature = payload.temperature ?? payload.temp;
  const humidity = payload.humidity;
  const airQuality = payload.airQuality;
  const luminosity = payload.luminosity ?? (payload.light !== undefined ? Math.round((payload.light / 4095) * 3000) : undefined);

  // AUDIT M12: validate that sensor values are within physically reasonable
  // ranges. Out-of-range values are set to undefined so they're stored as
  // NULL rather than corrupting analytics.
  const clampRange = (val: number | undefined, min: number, max: number, label: string) => {
    if (val === undefined || val === null) return undefined;
    if (typeof val !== 'number' || isNaN(val)) return undefined;
    if (val < min || val > max) {
      log("warn", "Sensor value out of range, storing as null", { label, value: val });
      return undefined;
    }
    return val;
  };

  const validTemp = clampRange(temperature, -50, 100, 'temperature');
  const validHumidity = clampRange(humidity, 0, 100, 'humidity');
  // air_quality is CO2 ppm from the MQ-135 (400-50000 range), NOT a 0-100
  // percentage. The original schema comment was wrong; the firmware sends ppm.
  const validAirQuality = clampRange(airQuality, 0, 50000, 'air_quality');
  const validLuminosity = clampRange(luminosity, 0, 100000, 'luminosity');

  // Parse node_id from topic: aether/<node_id>/telemetry or aether/sensors
  const segments = topic.split("/");
  const nodeId = segments.length >= 3 ? segments[1] : segments[segments.length - 1] ?? "node-01";

  // Compute heat index and comfort status server-side (closes G11)
  let heatIndex: number | undefined;
  let comfortStatus: string | undefined;

  if (validTemp !== undefined && validHumidity !== undefined) {
    heatIndex = Math.round(computeHeatIndex(validTemp, validHumidity) * 10) / 10;
    if (validAirQuality !== undefined) {
      comfortStatus = getComfortStatus(heatIndex, validAirQuality);
    }
  }

  return {
    node_id: nodeId,
    temperature: validTemp,
    humidity: validHumidity,
    heat_index: heatIndex,
    air_quality: validAirQuality,
    luminosity: validLuminosity,
    comfort_index: heatIndex,
    comfort_status: comfortStatus,
  };
}

// ---------------------------------------------------------------------------
// Main — long-running MQTT subscriber
// ---------------------------------------------------------------------------

Deno.serve(async (_req: Request) => {
  const mqttUrl = Deno.env.get("MQTT_BROKER_URL");
  const mqttUsername = Deno.env.get("MQTT_USERNAME");
  const mqttPassword = Deno.env.get("MQTT_PASSWORD");
  const mqttTopic = Deno.env.get("MQTT_TOPIC") ?? "aether/sensors";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!mqttUrl || !supabaseUrl || !serviceRoleKey) {
    log("error", "Missing required env vars");
    return new Response(
      JSON.stringify({ error: "Missing required env vars: MQTT_BROKER_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let messageCount = 0;
  let errorCount = 0;
  let connected = false;

  log("info", "Connecting to MQTT broker", { broker: mqttUrl, topic: mqttTopic });

  // AUDIT H6: exponential backoff for reconnection to avoid connection
  // storms during extended broker outages. mqtt.js doesn't support a
  // function for reconnectPeriod, so we manually manage the reconnect
  // delay by tracking attempts and overriding before each reconnect.
  let reconnectAttempts = 0;
  const maxReconnectPeriod = 30000;

  const client = mqtt.connect(mqttUrl, {
    username: mqttUsername || undefined,
    password: mqttPassword || undefined,
    protocolVersion: 5,
    reconnectPeriod: 3000,
    connectTimeout: 15000,
    clientId: `aether-ingest-${crypto.randomUUID().slice(0, 8)}`,
  });

  client.on("connect", () => {
    connected = true;
    reconnectAttempts = 0;
    log("info", "Connected to broker, subscribing...");
    client.subscribe(mqttTopic, { qos: 0 }, (err) => {
      if (err) {
        log("error", "Subscribe failed", { error: err.message });
        errorCount++;
      } else {
        log("info", "Subscribed", { topic: mqttTopic });
      }
    });
  });

  client.on("reconnect", () => {
    log("info", "Reconnecting...");
  });

  client.on("error", (err: Error) => {
    log("error", "Connection error", { error: err.message });
    errorCount++;
  });

  client.on("close", () => {
    connected = false;
    reconnectAttempts++;
    const delay = Math.min(maxReconnectPeriod, 3000 * Math.pow(2, reconnectAttempts - 1));
    log("warn", "Connection closed, reconnecting", { delayMs: delay, attempt: reconnectAttempts });
    client.options.reconnectPeriod = delay;
  });

  // Node-to-org cache so we don't query the nodes table on every message
  // (AUDIT C2: org_id must be set on every reading for RLS to work).
  const nodeOrgCache = new Map<string, string | null>();

  async function getOrgIdForNode(nodeId: string): Promise<string | null> {
    if (nodeOrgCache.has(nodeId)) return nodeOrgCache.get(nodeId) ?? null;
    const { data: node } = await supabase
      .from("nodes")
      .select("org_id")
      .eq("id", nodeId)
      .maybeSingle();
    const orgId = node?.org_id ?? null;
    nodeOrgCache.set(nodeId, orgId);
    // Refresh cache every 5 minutes by evicting stale entries
    setTimeout(() => nodeOrgCache.delete(nodeId), 5 * 60 * 1000);
    return orgId;
  }

  client.on("message", async (topic: string, payloadBuffer: Uint8Array) => {
    try {
      const payload: SensorPayload = JSON.parse(new TextDecoder().decode(payloadBuffer));
      const row = normalizePayload(payload, topic);

      // Look up org_id for this node so RLS scopes the reading correctly
      // (AUDIT C2: readings without org_id are invisible to org-scoped queries
      // and were visible to all users via the org_id-is-null RLS clause).
      // BUG FIX: after migration 0006, org_id is NOT NULL — skip readings
      // for unclaimed nodes instead of inserting with null org_id.
      const orgId = await getOrgIdForNode(row.node_id);
      if (!orgId) {
        log("warn", "Node not claimed, skipping reading", { nodeId: row.node_id });
        return;
      }
      row.org_id = orgId;

      const { data: insertedRow, error } = await supabase
        .from("sensor_readings")
        .insert(row)
        .select()
        .single();

      if (error) {
        log("error", "Insert failed", { topic, error: error.message });
        errorCount++;
      } else {
        messageCount++;
        if (messageCount % 50 === 0) {
          log("info", "Ingest progress", { messageCount, errorCount });
        }

        try {
          const alertRes = await fetch(
            `${supabaseUrl}/functions/v1/evaluate-alerts`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceRoleKey}`,
              },
              body: JSON.stringify({
                reading: {
                  ...insertedRow,
                  node_id: row.node_id,
                  org_id: orgId,
                },
              }),
              signal: AbortSignal.timeout(5000),
            }
          );
          if (!alertRes.ok) {
            log("warn", "evaluate-alerts returned non-OK", { status: alertRes.status });
          }
        } catch (alertErr) {
          log("warn", "Failed to call evaluate-alerts", { error: String(alertErr) });
        }
      }
    } catch (err) {
      log("error", "Malformed payload", { topic, error: String(err) });
      errorCount++;
    }
  });

  // Return an initial status response. The MQTT subscription continues
  // running in the background for the lifetime of the Edge Function
  // instance. Supabase keeps the function warm as long as it's active.
  return new Response(
    JSON.stringify({
      status: "started",
      broker: mqttUrl,
      topic: mqttTopic,
      connected,
      messageCount,
      errorCount,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
