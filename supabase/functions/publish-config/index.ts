// ---------------------------------------------------------------------------
// Project Aether — Edge Function: publish-config
//
// Publishes a node's desired configuration (from `device_settings`) to MQTT
// so the ESP32 picks it up without a reflash. This is the downlink half of
// the pipeline that ingest-mqtt provides the uplink for.
//
// Flow:
//   1. Settings page POSTs { nodeId } with the user's JWT in the
//      Authorization header.
//   2. This function verifies the JWT, then — using the service_role client —
//      looks up the node's org and confirms the caller is a member of it.
//      A customer must NEVER be able to configure another customer's device,
//      so membership is checked server-side, not inferred from the request.
//   3. Reads the device_settings row and serialises it into the exact key
//      names the firmware parses.
//   4. Publishes to aether/<nodeId>/config with qos 1 + retain.
//
// Deploy:
//   supabase functions deploy publish-config
//
// Env vars:
//   SUPABASE_URL              — set automatically by Supabase
//   SUPABASE_ANON_KEY         — used to verify the caller's JWT
//   SUPABASE_SERVICE_ROLE_KEY — used to read nodes/device_settings (bypasses RLS)
//   MQTT_BROKER_URL           — e.g. mqtts://xxxxxxxx.s1.eu.hivemq.cloud:8883
//   MQTT_USERNAME             — HiveMQ username
//   MQTT_PASSWORD             — HiveMQ password (server-only, never exposed)
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import mqtt from "https://esm.sh/mqtt@5.10.1";

// Rate limiter: 10 config publishes per user per 10 minutes.
const MAX_PUBLISHES = 10;
const WINDOW_MS = 10 * 60 * 1000;
const publishMap = new Map<string, { count: number; firstAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = publishMap.get(userId);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    publishMap.set(userId, { count: 1, firstAt: now });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_PUBLISHES;
}

// AUDIT H16/L10: structured logging helper.
function log(level: string, msg: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "publish-config", level, msg, ...meta }));
}

// AUDIT L10/L12: consistent error response shape across functions.
function errorResponse(status: number, error: string, requestId?: string) {
  return new Response(JSON.stringify({ error, requestId }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A publish must not be able to wedge the function forever if the broker
// accepts the TCP connection but never acknowledges (qos 1 puback).
const PUBLISH_TIMEOUT_MS = 10_000;

const MAX_WIFI_ENTRIES = 3;

interface WifiCredential {
  ssid: string;
  password: string;
}

interface DeviceSettings {
  co2_warn_ppm: number;
  co2_hazard_ppm: number;
  buzzer_enabled: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
  timezone_offset_minutes: number;
  display_page_seconds: number;
}

// ---------------------------------------------------------------------------
// Publish helper — connect, publish once, close cleanly.
//
// retain: true is deliberate. Devices sleep, drop off WiFi and reboot; a
// non-retained config message published while a node is offline would be
// silently lost and the node would keep running its stale settings. With the
// retained flag the broker replays the latest config the instant the device
// resubscribes, so provisioning works regardless of who is online first.
// ---------------------------------------------------------------------------
async function publishConfig(
  brokerUrl: string,
  username: string | undefined,
  password: string | undefined,
  topic: string,
  payload: string,
  requestId: string,
): Promise<void> {
  const client = mqtt.connect(brokerUrl, {
    username: username || undefined,
    password: password || undefined,
    protocolVersion: 5,
    reconnectPeriod: 0, // one-shot publish: don't retry in the background
    connectTimeout: 8000,
    clientId: `aether-config-${crypto.randomUUID().slice(0, 8)}`,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out publishing config to broker")),
        PUBLISH_TIMEOUT_MS,
      );

      const settle = (err?: Error) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };

      client.on("error", (err: Error) => settle(err));

      client.on("connect", () => {
        log("info", "Connected to broker, publishing config", { requestId, topic });
        client.publish(topic, payload, { qos: 1, retain: true }, (err?: Error) => {
          if (err) settle(err);
          else settle();
        });
      });
    });
  } finally {
    // Always close, even on timeout/error, so the instance doesn't leak
    // sockets across invocations.
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", requestId);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mqttUrl = Deno.env.get("MQTT_BROKER_URL");
  const mqttUsername = Deno.env.get("MQTT_USERNAME");
  const mqttPassword = Deno.env.get("MQTT_PASSWORD");

  if (!mqttUrl) {
    log("error", "Missing required env var MQTT_BROKER_URL", { requestId });
    return errorResponse(500, "Server misconfigured", requestId);
  }

  // Verify the caller's JWT and get their user ID (same pattern as claim-node).
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    log("warn", "Unauthorized config publish attempt", { requestId });
    return errorResponse(401, "Unauthorized", requestId);
  }

  // Rate limit: prevent config publish spam.
  if (!checkRateLimit(user.id)) {
    log("warn", "Rate limit exceeded for config publish", { requestId, userId: user.id });
    return errorResponse(429, "Too many config updates. Please wait a few minutes.", requestId);
  }

  // Parse the request body.
  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", requestId);
  }

  const { nodeId, wifi } = body;

  // AUDIT M13: validate input format and length to prevent abuse.
  if (!nodeId || typeof nodeId !== "string") {
    return errorResponse(400, "nodeId is required", requestId);
  }
  if (nodeId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(nodeId)) {
    return errorResponse(400, "nodeId must be 1-100 chars, alphanumeric/hyphen/underscore only", requestId);
  }

  // Optional WiFi credentials are pass-through only (see the payload note
  // further down).
  let wifiList: WifiCredential[] | undefined;
  if (wifi !== undefined && wifi !== null) {
    if (!Array.isArray(wifi) || wifi.length > MAX_WIFI_ENTRIES) {
      return errorResponse(400, `wifi must be an array of at most ${MAX_WIFI_ENTRIES} entries`, requestId);
    }
    for (const entry of wifi) {
      if (
        !entry || typeof entry !== "object" ||
        typeof entry.ssid !== "string" || !entry.ssid || entry.ssid.length > 32 ||
        typeof entry.password !== "string" || entry.password.length > 63
      ) {
        return errorResponse(400, "each wifi entry must be { ssid, password } with ssid 1-32 and password 0-63 chars", requestId);
      }
    }
    wifiList = wifi.map((entry: WifiCredential) => ({ ssid: entry.ssid, password: entry.password }));
  }

  // Service_role client: needed to resolve the node's org and read settings
  // regardless of the caller's RLS view, so that the membership check below
  // is the single authoritative gate.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: node, error: nodeError } = await adminClient
    .from("nodes")
    .select("id, org_id")
    .eq("id", nodeId)
    .maybeSingle();

  if (nodeError) {
    // AUDIT M15: log detailed error server-side, return generic message.
    log("error", "Node lookup failed", { requestId, nodeId, error: nodeError.message });
    return errorResponse(500, "Failed to publish config. Please try again.", requestId);
  }
  if (!node) {
    return errorResponse(404, "Node not found", requestId);
  }

  // CRITICAL: confirm the caller belongs to the node's org. Without this a
  // customer could push config (including buzzer state) to another
  // customer's hardware.
  const { data: membership, error: membershipError } = await adminClient
    .from("organization_members")
    .select("org_id, role")
    .eq("org_id", node.org_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    log("error", "Membership lookup failed", { requestId, nodeId, error: membershipError.message });
    return errorResponse(500, "Failed to publish config. Please try again.", requestId);
  }
  if (!membership) {
    log("warn", "Cross-org config publish attempt blocked", { requestId, nodeId, userId: user.id });
    return errorResponse(403, "You do not have access to this node.", requestId);
  }
  // Only owners and admins can push config to devices. Viewers cannot.
  if (!["owner", "admin"].includes(membership.role)) {
    log("warn", "Non-admin config publish attempt blocked", { requestId, nodeId, userId: user.id, role: membership.role });
    return errorResponse(403, "Only owners and admins can publish device config.", requestId);
  }

  const { data: settings, error: settingsError } = await adminClient
    .from("device_settings")
    .select(
      "co2_warn_ppm, co2_hazard_ppm, buzzer_enabled, quiet_hours_start, quiet_hours_end, timezone_offset_minutes, display_page_seconds",
    )
    .eq("node_id", nodeId)
    .maybeSingle();

  if (settingsError) {
    log("error", "Settings lookup failed", { requestId, nodeId, error: settingsError.message });
    return errorResponse(500, "Failed to publish config. Please try again.", requestId);
  }
  if (!settings) {
    return errorResponse(404, "No settings found for this node", requestId);
  }

  const s = settings as DeviceSettings;

  // These key names are the firmware's wire contract — do not rename them
  // without shipping matching firmware.
  const payload: Record<string, unknown> = {
    co2Warn: s.co2_warn_ppm,
    co2Hazard: s.co2_hazard_ppm,
    buzzer: s.buzzer_enabled,
    quietStart: s.quiet_hours_start,
    quietEnd: s.quiet_hours_end,
    tzMinutes: s.timezone_offset_minutes,
    pageSecs: s.display_page_seconds,
  };

  // WiFi credentials are pass-through ONLY. They come from the request body
  // and are deliberately never persisted in Postgres: storing plaintext
  // WPA passphrases (which the firmware needs verbatim, so they cannot be
  // hashed) would turn a database leak into a leak of every customer's
  // network. They live only in this request and in the retained MQTT
  // message on the broker.
  if (wifiList && wifiList.length > 0) {
    payload.wifi = wifiList;
  }

  const topic = `aether/${nodeId}/config`;

  try {
    await publishConfig(mqttUrl, mqttUsername, mqttPassword, topic, JSON.stringify(payload), requestId);
  } catch (err) {
    log("error", "Publish failed", { requestId, nodeId, topic, error: (err as Error).message });
    return errorResponse(502, "Failed to reach the device broker. Please try again.", requestId);
  }

  log("info", "Config published successfully", {
    requestId,
    nodeId,
    topic,
    orgId: node.org_id,
    wifiEntries: wifiList?.length ?? 0,
  });

  return new Response(
    JSON.stringify({ ok: true, topic, requestId }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
