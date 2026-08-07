import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findProfileIdByEmail,
  getSlackUserMapping,
  isExplicitSlackUserMapping,
  upsertSlackUserMapping,
  type SlackInstallationRow,
} from "@/lib/slack/installations";
import { getSlackUserInfo } from "@/lib/slack/client";
import type { SlackAttribution } from "./types";

export function resolveKnownSlackAttribution(input: {
  installation: SlackInstallationRow;
  slackUserId: string;
  existing: Awaited<ReturnType<typeof getSlackUserMapping>>;
}): SlackAttribution | null {
  if (isExplicitSlackUserMapping(input.existing)) {
    return {
      mode: "mapped_profile",
      mogplexUserId: input.existing.mogplex_user_id,
      slackEmail: input.existing.slack_email,
    };
  }

  if (
    input.installation.authed_user_slack_id &&
    input.slackUserId === input.installation.authed_user_slack_id
  ) {
    return {
      mode: "installer_fallback",
      mogplexUserId: input.installation.installed_by_user_id,
      slackEmail: input.existing?.slack_email ?? null,
    };
  }

  return null;
}

export async function findProfileGithubUsername(profileId: string | null) {
  if (!profileId) return null;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("github_username")
    .eq("id", profileId)
    .maybeSingle();
  if (error) {
    console.warn("[slack-event] github username lookup failed", {
      profileId,
      error,
    });
    return null;
  }
  const githubUsername = data?.github_username;
  return typeof githubUsername === "string" && githubUsername.trim()
    ? githubUsername.trim()
    : null;
}

export async function defaultResolveSlackAttribution(
  installation: SlackInstallationRow,
  slackUserId: string,
  botToken: string
): Promise<SlackAttribution> {
  const existing = await getSlackUserMapping({
    installationId: installation.id,
    slackUserId,
  });
  const knownAttribution = resolveKnownSlackAttribution({
    installation,
    slackUserId,
    existing,
  });
  if (knownAttribution) {
    return {
      ...knownAttribution,
      githubUsername: await findProfileGithubUsername(
        knownAttribution.mogplexUserId
      ),
    };
  }

  // Try to look up the Slack user's email and match it to a Mogplex profile.
  let slackEmail: string | null = existing?.slack_email ?? null;
  try {
    const userInfo = await getSlackUserInfo(botToken, slackUserId);
    slackEmail = userInfo.profile?.email ?? null;
  } catch (error) {
    console.warn("[slack-event] users.info lookup failed", error);
  }

  let matchedProfileId: string | null = null;
  if (slackEmail) {
    matchedProfileId = await findProfileIdByEmail(slackEmail);
  }

  await upsertSlackUserMapping({
    installationId: installation.id,
    slackUserId,
    mogplexUserId: matchedProfileId,
    slackEmail,
  });

  return matchedProfileId
    ? { mode: "legacy_email", mogplexUserId: null, slackEmail }
    : { mode: "unmapped", mogplexUserId: null, slackEmail };
}
