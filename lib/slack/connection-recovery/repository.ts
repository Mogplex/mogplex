import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyResourceOwnerScope } from "@/lib/team-resource-scope";
import {
  hasCapability,
  resolveMemberCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import { escapePostgrestLikePattern } from "@/lib/slack/slack-utils";
import type { ConnectionRecoveryRequest } from "./store";

type Client = Pick<typeof supabaseAdmin, "from">;
type Repository = {
  id: string;
  user_id: string;
  github_installation_id: number | null;
  is_hidden: boolean | null;
};
type Context = Pick<
  ConnectionRecoveryRequest,
  "user_id" | "product_team_id" | "repo_id" | "target"
>;

function scope(request: Context) {
  return request.product_team_id
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
}

export async function findRecoveryRepository(
  request: Context,
  db: Client = supabaseAdmin
): Promise<Repository | null> {
  if (request.target.provider !== "github" || !request.target.repository)
    return null;
  let query = db
    .from("repos")
    .select("id, user_id, github_installation_id, is_hidden")
    .eq("user_id", request.user_id)
    .ilike("full_name", escapePostgrestLikePattern(request.target.repository));
  query = request.repo_id
    ? query.eq("id", request.repo_id)
    : query.is("root_directory", null);
  const { data, error } = await applyResourceOwnerScope(
    query,
    scope(request)
  ).maybeSingle();
  if (error) throw new Error("Could not load repository visibility");
  return data as Repository | null;
}

/** Restore is an explicit Slack action, never a side effect of checking OAuth. */
export async function restoreRecoveryRepository(
  request: ConnectionRecoveryRequest,
  db: Client = supabaseAdmin
) {
  if (request.product_team_id) {
    const capabilities = await resolveMemberCapabilities(
      request.user_id,
      request.product_team_id
    );
    if (
      !hasCapability(capabilities, TEAM_RESOURCE_WRITE_CAPABILITY) ||
      !hasCapability(capabilities, "tools.github_api")
    )
      throw new Error(
        "Your team role does not allow restoring this repository."
      );
  }
  const repo = await findRecoveryRepository(request, db);
  if (!repo) throw new Error("Repository is no longer available.");
  const query = db
    .from("repos")
    .update({ is_hidden: false })
    .eq("id", repo.id)
    .eq("user_id", request.user_id);
  const { data, error } = await applyResourceOwnerScope(query, scope(request))
    .select("id")
    .maybeSingle();
  if (error || !data)
    throw new Error("Could not restore the repository. Try again.");
}
