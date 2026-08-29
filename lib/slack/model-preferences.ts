import { supabaseAdmin } from "@/lib/supabase/admin";

export type SlackModelPreferenceRow = {
  id: string;
  slack_installation_id: string;
  channel_id: string;
  slack_user_id: string;
  model_id: string;
  created_at: string;
  updated_at: string;
};

type SlackPreferenceClient = Pick<typeof supabaseAdmin, "from">;

export async function getSlackModelPreference(
  input: {
    installationId: string;
    channelId: string;
    slackUserId: string;
  },
  client: SlackPreferenceClient = supabaseAdmin
): Promise<SlackModelPreferenceRow | null> {
  const { data, error } = await client
    .from("slack_model_preferences")
    .select("*")
    .eq("slack_installation_id", input.installationId)
    .eq("channel_id", input.channelId)
    .eq("slack_user_id", input.slackUserId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load Slack model preference: ${error.message}`);
  }
  return (data ?? null) as SlackModelPreferenceRow | null;
}

export async function upsertSlackModelPreference(
  input: {
    installationId: string;
    channelId: string;
    slackUserId: string;
    modelId: string;
  },
  client: SlackPreferenceClient = supabaseAdmin
): Promise<SlackModelPreferenceRow> {
  const { data, error } = await client
    .from("slack_model_preferences")
    .upsert(
      {
        slack_installation_id: input.installationId,
        channel_id: input.channelId,
        slack_user_id: input.slackUserId,
        model_id: input.modelId,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "slack_installation_id,channel_id,slack_user_id",
      }
    )
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to save Slack model preference: ${error?.message ?? "no row"}`
    );
  }
  return data as SlackModelPreferenceRow;
}
