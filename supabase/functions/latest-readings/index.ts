// ---------------------------------------------------------------------------
// Project Aether — Edge Function: latest-readings
//
// Returns the latest reading per node for the calling user's org, with
// Cache-Control headers so the Supabase Edge network and the browser can
// cache the response for a short TTL. This reduces database load when
// multiple clients poll for the latest state (Phase D2).
//
// Cache strategy: s-maxage=5 (edge cache 5s), max-age=5 (browser 5s).
// This is short enough that readings feel live but long enough to absorb
// burst traffic (e.g. multiple components on the same page).
//
// Deploy:
//   supabase functions deploy latest-readings
//
// Env vars:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUDIT H16/L10: structured logging helper.
function log(level: string, msg: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "latest-readings", level, msg, ...meta }));
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed", requestId }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized", requestId }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: orgId, error: orgError } = await adminClient.rpc(
    "get_user_org_id",
    { p_user_id: user.id }
  );

  if (orgError || !orgId) {
    return new Response(JSON.stringify({ error: "No organization found", requestId }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: rows, error: rpcError } = await adminClient.rpc(
    "get_latest_readings_per_node",
    { p_org_id: orgId }
  );

  if (rpcError) {
    log("error", "RPC failed", { requestId, error: rpcError.message });
    return new Response(JSON.stringify({ error: "Failed to fetch readings", requestId }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const readings = (rows || []).map((row: any) => ({
    id: row.node_id,
    name: row.node_name,
    room: row.room,
    temperature: row.temperature,
    humidity: row.humidity,
    heatIndex: row.heat_index,
    airQuality: row.air_quality,
    luminosity: row.luminosity,
    comfortStatus: row.comfort_status,
    recordedAt: row.recorded_at,
  }));

  const body = JSON.stringify({ readings, requestId });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=5, max-age=5, stale-while-revalidate=10",
      "CDN-Cache-Control": "public, s-maxage=5",
    },
  });
});
