import {
  isExplicitSlackUserMapping,
  type SlackInstallationRow,
  type SlackUserMappingRow,
} from "./installations";

export function resolveSlackCommandUserId(
  installation: SlackInstallationRow,
  mapping: SlackUserMappingRow | null,
  slackUserId: string
) {
  if (isExplicitSlackUserMapping(mapping)) return mapping.mogplex_user_id;
  return installation.authed_user_slack_id === slackUserId
    ? installation.installed_by_user_id
    : null;
}
