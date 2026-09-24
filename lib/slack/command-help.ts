import { buildSlackCommandHubBlocks } from "./command-blocks";

export function buildSlackCommandHelpResponse() {
  return {
    response_type: "ephemeral" as const,
    replace_original: false,
    text: "Mogplex commands: status, repo, prs, issues, usage, model, harness, agent, and cancel. Use `/mogplex-cancel` to stop your active run.",
    blocks: buildSlackCommandHubBlocks(),
  };
}
