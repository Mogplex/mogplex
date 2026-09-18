import { listAccessibleAgentRows } from "@/lib/agents/runtime/store";
import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import type { AgentRuntimeRow } from "@/lib/agents/runtime/types";
import type {
  getSlackAgentPreference,
  upsertSlackAgentPreference,
  SlackHarnessScope,
} from "./harness-preferences";

export type SlackAgentCommandDeps = {
  getAgentPreference: typeof getSlackAgentPreference;
  saveAgentPreference: typeof upsertSlackAgentPreference;
  listAgentsForUser: (userId: string) => Promise<AgentRuntimeRow[]>;
};

export const defaultSlackAgentCommandListAgents: SlackAgentCommandDeps["listAgentsForUser"] =
  (userId) => listAccessibleAgentRows({ userId });

const USAGE =
  "Usage: `/mogplex agent <slug or name>` to run repository tasks as a roster agent, `/mogplex agent none` to clear.";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

/** Matches a roster row by slug or name, then a preset by name. */
export function findAgentSelection(
  rows: AgentRuntimeRow[],
  argument: string
): { id: string; name: string } | null {
  const wanted = normalize(argument);
  if (!wanted) return null;
  const row = rows.find(
    (entry) =>
      (entry.slug && normalize(entry.slug) === wanted) ||
      normalize(entry.name) === wanted
  );
  if (row) return { id: row.id, name: row.name };
  const preset = PRECONFIGURED_AGENTS.find(
    (template) => normalize(template.name) === wanted
  );
  return preset ? { id: `preset:${preset.name}`, name: preset.name } : null;
}

/** Called only after the signed command's Slack actor has been authorized. */
export async function slackAgentCommandText(
  deps: SlackAgentCommandDeps,
  scope: SlackHarnessScope,
  mogplexUserId: string,
  argument: string
): Promise<string> {
  const wanted = argument.trim();
  if (!wanted) {
    const saved = await deps.getAgentPreference(scope);
    const rows = saved ? await deps.listAgentsForUser(mogplexUserId) : [];
    const current = saved
      ? (rows.find((row) => row.id === saved)?.name ??
        (saved.startsWith("preset:") ? saved.slice("preset:".length) : null))
      : null;
    return `Current agent: ${current ?? "none (harness default)"}.\n${USAGE}\nApplies to new repository runs in this channel, not conversational replies.`;
  }
  if (["none", "clear", "off", "default"].includes(normalize(wanted))) {
    await deps.saveAgentPreference({ ...scope, agentId: null });
    return "Agent cleared for your next repository run in this channel. Existing runs are unchanged.";
  }
  const rows = await deps.listAgentsForUser(mogplexUserId);
  const selection = findAgentSelection(rows, wanted);
  if (!selection) {
    const names = rows
      .slice(0, 12)
      .map((row) => row.slug ?? row.name)
      .join(", ");
    return `No agent matches "${wanted}".${names ? ` Your agents: ${names}.` : ""}\n${USAGE}`;
  }
  await deps.saveAgentPreference({ ...scope, agentId: selection.id });
  return `Agent set to ${selection.name} for your next repository run in this channel. Existing runs are unchanged.`;
}
