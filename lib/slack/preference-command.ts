import type { ParsedCommand } from "./command-parse";
import {
  slackAgentCommandText,
  type SlackAgentCommandDeps,
} from "./agent-command";
import {
  slackHarnessCommandText,
  type SlackHarnessCommandDeps,
} from "./harness-command";

/** `/mogplex harness` and `/mogplex agent` share one channel-scoped row. */
export async function preferenceCommandText(
  deps: SlackHarnessCommandDeps & SlackAgentCommandDeps,
  payload: { channelId: string; slackUserId: string },
  user: { installation: { id: string }; mogplexUserId: string },
  command: ParsedCommand
) {
  const scope = {
    installationId: user.installation.id,
    channelId: payload.channelId,
    slackUserId: payload.slackUserId,
  };
  return command.name === "agent"
    ? slackAgentCommandText(deps, scope, user.mogplexUserId, command.argument)
    : slackHarnessCommandText(deps, scope, command.argument);
}
