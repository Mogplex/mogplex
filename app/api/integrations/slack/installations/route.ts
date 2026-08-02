import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { listSlackInstallationsForUser } from "@/lib/slack/installations";

/**
 * List the Slack workspaces the current user has installed Mogplex into.
 * Used by the Connections pane to render the per-workspace management UI.
 */
export async function GET() {
  const userIdOrResponse = await requireUserId();
  if (userIdOrResponse instanceof Response) return userIdOrResponse;

  const rows = await listSlackInstallationsForUser(userIdOrResponse);
  return NextResponse.json({
    installations: rows.map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      botUserId: row.bot_user_id,
      scopes: row.scopes,
      installedAt: row.created_at,
      repoAgentEnabled: row.repo_agent_enabled !== false,
      allowedSlackUserIds: row.allowed_slack_user_ids ?? null,
      monthlyRepoRunLimit: row.monthly_repo_run_limit ?? null,
    })),
  });
}
