import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyResourceOwnerScope } from "@/lib/team-resource-scope";
import {
  hasCapability,
  resolveMemberCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import type { ConnectionRecoveryRequest } from "./store";

type Client = Pick<typeof supabaseAdmin, "from">;

async function loadScope(request: ConnectionRecoveryRequest, db: Client) {
  if (request.target.provider !== "connection") return null;
  const { data: connection, error } = await db
    .from("connections")
    .select("id, scope, repo_id, is_enabled")
    .eq("id", request.target.connectionId)
    .eq("user_id", request.user_id)
    .maybeSingle();
  if (error) throw new Error("Could not load connection scope");
  if (!connection) return null;
  if (!request.repo_id) return { connection, repo: null, excluded: false };
  const owner = request.product_team_id
    ? {
        kind: "team" as const,
        userId: request.user_id,
        productTeamId: request.product_team_id,
      }
    : {
        kind: "personal" as const,
        userId: request.user_id,
        productTeamId: null,
      };
  const query = db
    .from("repos")
    .select("id, full_name")
    .eq("id", request.repo_id)
    .eq("user_id", request.user_id);
  const { data: repo, error: repoError } = await applyResourceOwnerScope(
    query,
    owner
  ).maybeSingle();
  if (repoError) throw new Error("Could not load repository scope");
  if (!repo) return null;
  const { data: override, error: overrideError } = await db
    .from("repo_connection_overrides")
    .select("excluded")
    .eq("repo_id", repo.id)
    .eq("connection_id", connection.id)
    .maybeSingle();
  if (overrideError) throw new Error("Could not load connection scope");
  return { connection, repo, excluded: override?.excluded === true };
}

export async function describeConnectionScope(
  request: ConnectionRecoveryRequest,
  db: Client = supabaseAdmin
) {
  const scope = await loadScope(request, db);
  if (!scope) return undefined;
  const { connection, repo, excluded } = scope;
  const moving =
    repo && connection.scope === "project" && connection.repo_id !== repo.id;
  if (connection.is_enabled && !moving && !excluded) return undefined;
  return {
    label: repo ? "Use for this repository" : "Enable connection",
    explanation: moving
      ? `Enable this connection and move it to ${repo.full_name}. It will no longer be available in its previous project.`
      : repo
        ? `Enable this connection and include it for ${repo.full_name}. Its tool approval settings will stay the same.`
        : "Enable this connection in Mogplex. Its project scope and tool approval settings will stay the same.",
  };
}

/** Only an explicit, confirmed Slack action changes a saved connection's scope. */
export async function repairConnectionScope(
  request: ConnectionRecoveryRequest,
  db: Client = supabaseAdmin
) {
  if (request.product_team_id) {
    const caps = await resolveMemberCapabilities(
      request.user_id,
      request.product_team_id
    );
    if (
      !hasCapability(caps, "connections.create") ||
      !hasCapability(caps, TEAM_RESOURCE_WRITE_CAPABILITY)
    )
      throw new Error(
        "Your team role does not allow changing this connection."
      );
  }
  const scope = await loadScope(request, db);
  if (!scope)
    throw new Error("Connection or repository is no longer available.");
  const { connection, repo } = scope;
  const { data, error } = await db
    .from("connections")
    .update({
      is_enabled: true,
      ...(repo && connection.scope === "project" ? { repo_id: repo.id } : {}),
    })
    .eq("id", connection.id)
    .eq("user_id", request.user_id)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("Could not update connection scope");
  if (repo && connection.scope === "global") {
    const result = await db
      .from("repo_connection_overrides")
      .delete()
      .eq("repo_id", repo.id)
      .eq("connection_id", connection.id);
    if (result.error)
      throw new Error("Could not include the connection for this repository");
  }
}
