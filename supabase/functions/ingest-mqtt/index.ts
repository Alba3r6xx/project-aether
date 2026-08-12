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
// Uses @ymjacky/mqtt5 (Deno-native MQTT v5 client, zero third-party deps)
// instead of the npm `mqtt` package which pulls in `ws` (Node.js-only).
//
// ENV VARS (set in Supabase Dashboard > Edge Functions > ingest-mqtt > Secrets):
//   MQTT_BROKER_URL   - e.g. mqtts://xxxxxxxx.s1.eu.hivemq.cloud:8883
//   MQTT_USERNAME     - HiveMQ username
//   MQTT_PASSWORD     - HiveMQ password (server-only, never exposed to browser)
//   MQTT_TOPIC        - e.g. aether/+/telemetry  (default: aether/+/telemetry)
//                        Wildcard "+" matches any node_id, so aether/node-01/telemetry,
//                        aether/node-02/telemetry, etc. are all received.
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
import { Mqtt, MqttClient } from "jsr:@ymjacky/mqtt5";

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

function getComfortStatus(airQuality: number): string {
  // Match the firmware's airStatusFor() exactly — CO2 ppm only, no heat index.
  // The firmware uses: >5000=HAZARD, >2000=POOR, >1000=FAIR, <=1000=GOOD.
  if (airQuality > 5000) return "HAZARD";
  if (airQuality > 2000) return "POOR";
  if (airQuality > 1000) return "FAIR";
  return "GOOD";
}

// ---------------------------------------------------------------------------
// Payload normalization — maps the firmware's field names to our schema
// ---------------------------------------------------------------------------

interface SensorPayload {
  node_id?: string;
  nodeId?: string;
  id?: string;
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
  // The firmware sends "light" as a raw ADC value (0-4095). Store it
  // directly as luminosity — the dashboard can interpret the raw value.
  const luminosity = payload.luminosity ?? payload.light;

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
  const topicNodeId = segments.length >= 3 ? segments[1] : null;

  // Fall back to node_id from the payload if the topic doesn't carry one
  // (e.g. firmware publishes to a flat topic like "aether/sensors").
  const payloadNodeId = payload.node_id ?? payload.nodeId ?? payload.id;
  const nodeId = topicNodeId ?? payloadNodeId ?? "node-01";

  // Compute heat index (stored for analytics) and comfort status
  // (matches firmware's airStatusFor — CO2 ppm only, no heat index).
  let heatIndex: number | undefined;
  let comfortStatus: string | undefined;

  if (validTemp !== undefined && validHumidity !== undefined) {
    heatIndex = Math.round(computeHeatIndex(validTemp, validHumidity) * 10) / 10;
  }
  if (validAirQuality !== undefined) {
    comfortStatus = getComfortStatus(validAirQuality);
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
  const mqttTopic = Deno.env.get("MQTT_TOPIC") ?? "aether/+/telemetry";
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

  log("info", "Connecting to MQTT broker", { broker: mqttUrl, topic: mqttTopic });

  // Build the MQTT client using the Deno-native @ymjacky/mqtt5 library.
  // Supports mqtts:// (TLS) and MQTT v5.0, matching the firmware's protocolVersion: 5.
  const client = new MqttClient({
    url: new URL(mqttUrl),
    clientId: `aether-ingest-${crypto.randomUUID().slice(0, 8)}`,
    username: mqttUsername || undefined,
    password: mqttPassword || undefined,
    protocolVersion: Mqtt.ProtocolVersion.MQTT_V5,
    keepAlive: 30,
    clean: true,
    logger: (msg: string, ...args: unknown[]) => {
      log("debug", `mqtt5: ${msg}`, { args: args.map(String).join(" ") });
    },
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

  // Handle incoming messages.
  client.on("message", async (topic: string, payload: Uint8Array) => {
    try {
      const parsed: SensorPayload = JSON.parse(new TextDecoder().decode(payload));
      const row = normalizePayload(parsed, topic);

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

        // Fire-and-forget alert evaluation (non-blocking).
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

  // AUDIT H9: track connection status for the response.
  client.on("closed", () => {
    log("warn", "Connection closed, reconnecting...");
  });

  client.on("error", (err: Error) => {
    log("error", "Connection error", { error: err.message });
    errorCount++;
  });

  // Connect and subscribe.
  try {
    await client.connect();
    log("info", "Connected to broker, subscribing...");

    await client.subscribe(mqttTopic, Mqtt.QoS.AT_MOST_ONCE);
    log("info", "Subscribed", { topic: mqttTopic });
  } catch (err) {
    log("error", "Connect/subscribe failed", { error: String(err) });
    return new Response(
      JSON.stringify({ status: "error", error: String(err), messageCount, errorCount }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Return an initial status response. The MQTT subscription continues
  // running in the background for the lifetime of the Edge Function
  // instance. Supabase keeps the function warm as long as it's active.
  return new Response(
    JSON.stringify({
      status: "started",
      broker: mqttUrl,
      topic: mqttTopic,
      connected: true,
      messageCount,
      errorCount,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
