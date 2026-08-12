// ---------------------------------------------------------------------------
// Project Aether — Edge Function: delete-node
//
// Removes a node from the calling user's organization. Called by the
// Settings page's node list (trash icon on each row).
//
// Flow:
//   1. Browser POSTs { nodeId } with the user's JWT in the Authorization header.
//   2. This function verifies the JWT, looks up the user's org, and confirms
//      the node belongs to that org (so users can't delete other orgs' nodes).
//   3. Deletes the node row. ON DELETE CASCADE in the schema handles
//      device_settings, alert_rules, etc.
//
// Deploy:
//   supabase functions deploy delete-node
//
// Env vars (set automatically by Supabase):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

function log(level: string, msg: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "delete-node", level, msg, ...meta }));
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const errorResponse = (status: number, error: string, id = requestId) =>
    jsonResponse(req, { error, requestId: id }, status);

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify the caller's JWT.
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
    log("warn", "Unauthorized delete attempt", { requestId });
    return errorResponse(401, "Unauthorized", requestId);
  }

  // Parse the request body.
  let body;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", requestId);
  }

  const { nodeId } = body;

  if (!nodeId || typeof nodeId !== "string") {
    return errorResponse(400, "nodeId is required", requestId);
  }
  if (nodeId.length > 100 || !/^[a-zA-Z0-9 _-]+$/.test(nodeId)) {
    return errorResponse(400, "nodeId must be 1-100 chars, alphanumeric/space/hyphen/underscore only", requestId);
  }

  // Use the service_role client to look up the user's org and delete the node.
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
    return errorResponse(400, "User has no organization.", requestId);
  }

  // Verify the node belongs to this org before deleting.
  const { data: existing } = await adminClient
    .from("nodes")
    .select("id, org_id")
    .eq("id", nodeId)
    .maybeSingle();

  if (!existing) {
    return errorResponse(404, "Node not found.", requestId);
  }

  if (existing.org_id !== orgId) {
    log("warn", "Attempted to delete another org's node", { requestId, nodeId, userId: user.id });
    return errorResponse(403, "You do not have permission to delete this node.", requestId);
  }

  // Delete the node. ON DELETE CASCADE handles child rows (device_settings,
  // alert_rules, sensor_readings via FK, etc.).
  const { error: deleteError } = await adminClient
    .from("nodes")
    .delete()
    .eq("id", nodeId);

  if (deleteError) {
    log("error", "Delete failed", { requestId, nodeId, error: deleteError.message });
    return errorResponse(500, "Failed to delete node. Please try again.", requestId);
  }

  log("info", "Node deleted successfully", { requestId, nodeId, orgId });
  return jsonResponse(req, { success: true, requestId });
});
