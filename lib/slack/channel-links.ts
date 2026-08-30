import { supabaseAdmin } from "@/lib/supabase/admin";

export type SlackChannelLinkRow = {
  id: string;
  slack_installation_id: string;
  channel_id: string;
  channel_name: string | null;
  repo_id: string;
  created_by_user_id: string;
  created_at: string;
};

export async function getSlackChannelLink(input: {
  installationId: string;
  channelId: string;
}): Promise<SlackChannelLinkRow | null> {
  const { data, error } = await supabaseAdmin
    .from("slack_channel_links")
    .select("*")
    .eq("slack_installation_id", input.installationId)
    .eq("channel_id", input.channelId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load slack_channel_link: ${error.message}`);
  }
  return (data ?? null) as SlackChannelLinkRow | null;
}

export async function listSlackChannelLinks(
  installationId: string
): Promise<SlackChannelLinkRow[]> {
  const { data, error } = await supabaseAdmin
    .from("slack_channel_links")
    .select("*")
    .eq("slack_installation_id", installationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list slack_channel_links: ${error.message}`);
  }
  return (data ?? []) as SlackChannelLinkRow[];
}

export async function createSlackChannelLink(input: {
  installationId: string;
  channelId: string;
  channelName: string | null;
  repoId: string;
  createdByUserId: string;
}): Promise<SlackChannelLinkRow> {
  const { data, error } = await supabaseAdmin
    .from("slack_channel_links")
    .insert({
      slack_installation_id: input.installationId,
      channel_id: input.channelId,
      channel_name: input.channelName,
      repo_id: input.repoId,
      created_by_user_id: input.createdByUserId,
    })
    .select("*")
    .single();

  if (error || !data) {
    const wrapped = new Error(
      `Failed to create slack_channel_link: ${error?.message ?? "no row"}`,
      { cause: error }
    ) as Error & { code?: string };
    wrapped.code = error?.code;
    throw wrapped;
  }
  return data as SlackChannelLinkRow;
}

export async function setSlackChannelLink(
  input: {
    installationId: string;
    channelId: string;
    channelName: string | null;
    repoId: string;
    createdByUserId: string;
  },
  client: Pick<typeof supabaseAdmin, "from"> = supabaseAdmin
): Promise<SlackChannelLinkRow> {
  const { data, error } = await client
    .from("slack_channel_links")
    .upsert(
      {
        slack_installation_id: input.installationId,
        channel_id: input.channelId,
        channel_name: input.channelName,
        repo_id: input.repoId,
        created_by_user_id: input.createdByUserId,
      },
      { onConflict: "slack_installation_id,channel_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to set slack_channel_link: ${error?.message ?? "no row"}`
    );
  }
  return data as SlackChannelLinkRow;
}

export async function deleteSlackChannelLink(input: {
  linkId: string;
  installationId: string;
  createdByUserId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("slack_channel_links")
    .delete()
    .eq("id", input.linkId)
    .eq("slack_installation_id", input.installationId)
    .eq("created_by_user_id", input.createdByUserId);

  if (error) {
    throw new Error(`Failed to delete slack_channel_link: ${error.message}`);
  }
}
