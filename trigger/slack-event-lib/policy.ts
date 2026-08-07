import type { SlackInstallationRow } from "@/lib/slack/installations";
import type { SlackEventTaskDeps, SlackRepoAgentPolicy } from "./types";
import { monthStartDate } from "./quota";

export async function evaluateSlackRepoAgentPolicy(input: {
  deps: Pick<SlackEventTaskDeps, "now" | "reserveSlackRepoAgentMonthlyRun">;
  eventId: string;
  installation: SlackInstallationRow;
  slackUserId: string;
}): Promise<SlackRepoAgentPolicy> {
  if (input.installation.repo_agent_enabled === false) {
    return {
      allowed: false,
      outcome: "repo_agent_disabled",
      message: ":lock: Repo agent runs are disabled for this Slack workspace.",
    };
  }

  const allowedUserIds = input.installation.allowed_slack_user_ids;
  if (
    Array.isArray(allowedUserIds) &&
    !allowedUserIds.includes(input.slackUserId)
  ) {
    return {
      allowed: false,
      outcome: "repo_agent_user_not_allowed",
      message:
        ":lock: You are not allowed to start repo agent runs from this Slack workspace.",
    };
  }

  const monthlyLimit = input.installation.monthly_repo_run_limit;
  if (typeof monthlyLimit === "number" && monthlyLimit > 0) {
    const quotaMonthStartDate = monthStartDate(input.deps.now());
    const reserved = await input.deps.reserveSlackRepoAgentMonthlyRun({
      installationId: input.installation.id,
      teamId: input.installation.team_id,
      eventId: input.eventId,
      monthStartDate: quotaMonthStartDate,
      monthlyLimit,
    });
    if (!reserved) {
      return {
        allowed: false,
        outcome: "repo_agent_monthly_limit_reached",
        message:
          ":warning: This Slack workspace has reached its monthly repo agent run limit.",
      };
    }

    return {
      allowed: true,
      quotaReservation: {
        teamId: input.installation.team_id,
        eventId: input.eventId,
        monthStartDate: quotaMonthStartDate,
      },
    };
  }

  return { allowed: true };
}
