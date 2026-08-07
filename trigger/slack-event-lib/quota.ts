import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SlackEventTaskDeps } from "./types";

export function monthStartDate(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export async function defaultReserveSlackRepoAgentMonthlyRun(input: {
  installationId: string;
  teamId: string;
  eventId: string;
  monthStartDate: string;
  monthlyLimit: number;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    "reserve_slack_repo_agent_monthly_run",
    {
      p_slack_installation_id: input.installationId,
      p_team_id: input.teamId,
      p_month_start: input.monthStartDate,
      p_slack_event_id: input.eventId,
      p_monthly_limit: input.monthlyLimit,
    }
  );

  if (error) {
    throw new Error(
      `Failed to reserve Slack repo-agent monthly quota: ${error.message}`
    );
  }
  return data === true;
}

export async function defaultReleaseSlackRepoAgentMonthlyRun(input: {
  teamId: string;
  eventId: string;
  monthStartDate: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.rpc(
    "release_slack_repo_agent_monthly_run",
    {
      p_team_id: input.teamId,
      p_month_start: input.monthStartDate,
      p_slack_event_id: input.eventId,
    }
  );

  if (error) {
    throw new Error(
      `Failed to release Slack repo-agent monthly quota: ${error.message}`
    );
  }
}

export async function releaseSlackRepoAgentQuotaReservationBestEffort(
  deps: Pick<SlackEventTaskDeps, "releaseSlackRepoAgentMonthlyRun">,
  reservation: { teamId: string; eventId: string; monthStartDate: string }
) {
  try {
    await deps.releaseSlackRepoAgentMonthlyRun(reservation);
  } catch (error) {
    console.warn("[slack-event] failed to release repo-agent quota", {
      teamId: reservation.teamId,
      eventId: reservation.eventId,
      monthStartDate: reservation.monthStartDate,
      error,
    });
  }
}
