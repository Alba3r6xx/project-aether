// ---------------------------------------------------------------------------
// Project Aether — Edge Function: claim-node
//
// Binds an ESP32 node to the calling user's organization. Called by the
// Settings page's "Add node" form (closes G14: nodes are claimable, not
// hardcoded).
//
// Flow:
//   1. User enters a node_id (e.g. "node-01") and a friendly name/room.
//   2. Browser POSTs { nodeId, name, room } to this function with the
//      user's JWT in the Authorization header.
//   3. This function looks up the user's org via get_user_org_id().
//   4. Inserts a row into the `nodes` table with (id, org_id, name, room).
//   5. Returns the claimed node.
//
// AUDIT H14: rate limiting — max 5 claim attempts per user per 10 minutes,
// tracked via a lightweight in-memory counter (per Edge Function instance).
// For production with multiple instances, use a Supabase table-based limiter.
//
// Deploy:
//   supabase functions deploy claim-node
//
// Env vars (set automatically by Supabase):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY    — used to verify the caller's JWT
//   SUPABASE_SERVICE_ROLE_KEY — used to insert into nodes (bypasses RLS)
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUDIT H14: simple in-memory rate limiter (per-instance, per-user).
// Limits to MAX_ATTEMPTS per user per WINDOW_MS.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const attemptMap = new Map<string, { count: number; firstAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = attemptMap.get(userId);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attemptMap.set(userId, { count: 1, firstAt: now });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_ATTEMPTS;
}

// AUDIT L10/L12: structured logging helper + consistent error response.
function log(level: string, msg: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "claim-node", level, msg, ...meta }));
}

function errorResponse(status: number, error: string, requestId?: string) {
  return new Response(JSON.stringify({ error, requestId }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", requestId);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify the caller's JWT and get their user ID.
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
    log("warn", "Unauthorized claim attempt", { requestId });
    return errorResponse(401, "Unauthorized", requestId);
  }

  // AUDIT H14: rate limit check.
  if (!checkRateLimit(user.id)) {
    log("warn", "Rate limit exceeded", { requestId, userId: user.id });
    return errorResponse(429, "Too many claim attempts. Please try again later.", requestId);
  }

  // Parse the request body.
  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", requestId);
  }

  const { nodeId, name, room, floor, location } = body;

  // AUDIT M13: validate input format and length to prevent abuse.
  if (!nodeId || typeof nodeId !== "string") {
    return errorResponse(400, "nodeId is required", requestId);
  }
  if (nodeId.length > 100 || !/^[a-zA-Z0-9 _-]+$/.test(nodeId)) {
    return errorResponse(400, "nodeId must be 1-100 chars, alphanumeric/space/hyphen/underscore only", requestId);
  }
  if (!name || typeof name !== "string") {
    return errorResponse(400, "name is required", requestId);
  }
  if (name.length > 100) {
    return errorResponse(400, "name must be 100 characters or fewer", requestId);
  }
  // BUG FIX: validate optional field lengths to prevent abuse.
  if (room && (typeof room !== "string" || room.length > 100)) {
    return errorResponse(400, "room must be 100 characters or fewer", requestId);
  }
  if (floor && (typeof floor !== "string" || floor.length > 100)) {
    return errorResponse(400, "floor must be 100 characters or fewer", requestId);
  }
  if (location && (typeof location !== "string" || location.length > 255)) {
    return errorResponse(400, "location must be 255 characters or fewer", requestId);
  }

  // Use the service_role client to look up the user's org and insert the node.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Get the user's primary org.
  const { data: orgId, error: orgError } = await adminClient.rpc(
    "get_user_org_id",
    { p_user_id: user.id }
  );

  if (orgError || !orgId) {
    log("warn", "User has no organization", { requestId, userId: user.id });
    return errorResponse(400, "User has no organization. Sign up first.", requestId);
  }

  // Check if the node is already claimed.
  const { data: existing } = await adminClient
    .from("nodes")
    .select("id, org_id")
    .eq("id", nodeId)
    .maybeSingle();

  if (existing) {
    if (existing.org_id === orgId) {
      return errorResponse(409, "This node is already claimed by your organization.", requestId);
    }
    log("warn", "Node already claimed by another org", { requestId, nodeId });
    return errorResponse(409, "This node is already claimed by another organization.", requestId);
  }

  // Claim the node. AUDIT H10: rely on the primary key constraint to
  // handle the race condition atomically — if two requests try to claim
  // the same node concurrently, the second gets a 23505 unique violation.
  const { data: node, error: insertError } = await adminClient
    .from("nodes")
    .insert({
      id: nodeId,
      org_id: orgId,
      name,
      room: room || null,
      floor: floor || null,
      location: location || null,
    })
    .select()
    .single();

  if (insertError) {
    // AUDIT H10: handle unique violation (concurrent claim race condition).
    if (insertError.code === "23505") {
      log("warn", "Node claimed via race condition", { requestId, nodeId });
      return errorResponse(409, "This node was just claimed by someone else. Please try a different node ID.", requestId);
    }
    // AUDIT M15: log detailed error server-side, return generic message to client.
    log("error", "Insert failed", { requestId, nodeId, error: insertError.message });
    return errorResponse(500, "Failed to claim node. Please try again.", requestId);
  }

  log("info", "Node claimed successfully", { requestId, nodeId, orgId });
  return new Response(
    JSON.stringify({ success: true, node, requestId }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
