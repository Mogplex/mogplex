import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  MOGPLEX_API_RUN_HARNESSES as MOGPLEX_API_HARNESSES,
  type MogplexApiRunHarness as MogplexApiHarness,
} from "@/lib/mogplex-api/runs-types";

export type SlackHarnessScope = {
  installationId: string;
  channelId: string;
  slackUserId: string;
};

type Client = Pick<typeof supabaseAdmin, "from">;

export async function getSlackHarnessPreference(
  scope: SlackHarnessScope,
  client: Client = supabaseAdmin
): Promise<MogplexApiHarness | null> {
  const { data, error } = await client
    .from("slack_harness_preferences")
    .select("harness")
    .eq("slack_installation_id", scope.installationId)
    .eq("channel_id", scope.channelId)
    .eq("slack_user_id", scope.slackUserId)
    .maybeSingle();
  if (error)
    throw new Error(
      `Failed to load Slack harness preference: ${error.message}`
    );
  if (!data) return null;
  if (!MOGPLEX_API_HARNESSES.includes(data.harness as MogplexApiHarness)) {
    throw new Error("Invalid saved Slack harness preference");
  }
  return data.harness as MogplexApiHarness;
}

export async function upsertSlackHarnessPreference(
  input: SlackHarnessScope & { harness: MogplexApiHarness },
  client: Client = supabaseAdmin
): Promise<void> {
  if (!MOGPLEX_API_HARNESSES.includes(input.harness))
    throw new Error("Invalid harness");
  const { error } = await client.from("slack_harness_preferences").upsert(
    {
      slack_installation_id: input.installationId,
      channel_id: input.channelId,
      slack_user_id: input.slackUserId,
      harness: input.harness,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slack_installation_id,channel_id,slack_user_id" }
  );
  if (error)
    throw new Error(
      `Failed to save Slack harness preference: ${error.message}`
    );
}
