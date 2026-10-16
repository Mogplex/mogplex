import { getCanonicalAppUrl } from "@/lib/app-url";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { isUuid } from "@/lib/uuid";
import {
  getSlackBotToken,
  presentSlackEntityDetails,
  unfurlSlackLinks,
} from "./client";
import { resolveSlackCommandUserId } from "./command-identity";
import {
  getSlackInstallationByTeamId,
  getSlackUserMapping,
} from "./installations";
import { readSlackRunControlsMetadata } from "./run-controls";
import { buildRunWorkObject, parseRunLink } from "./work-objects";

/** Links unfurled per message; the rest stay plain links. */
const MAX_UNFURLS = 5;

export type SlackLinkSharedEvent = {
  type: "link_shared";
  channel?: string;
  user?: string;
  message_ts?: string;
  unfurl_id?: string;
  source?: string;
  links?: { url?: string; domain?: string }[];
};

export type SlackEntityDetailsRequestedEvent = {
  type: "entity_details_requested";
  user?: string;
  channel?: string;
  trigger_id?: string;
  external_ref?: { id?: string; type?: string };
  entity_url?: string;
};

async function loadRunAnyOwner(runId: string) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("external_agent_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load run: ${error.message}`);
  return (data as ExternalAgentRunRow | null) ?? null;
}

async function loadRepoName(run: ExternalAgentRunRow) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data } = await supabaseAdmin
    .from("repos")
    .select("full_name")
    .eq("id", run.repo_id)
    .eq("user_id", run.user_id)
    .maybeSingle();
  return (data as { full_name?: string } | null)?.full_name ?? null;
}

const defaultDeps = {
  getInstallation: getSlackInstallationByTeamId,
  getUserMapping: getSlackUserMapping,
  getBotToken: getSlackBotToken,
  loadRun: loadRunAnyOwner,
  loadRepoName,
  unfurl: unfurlSlackLinks,
  presentDetails: presentSlackEntityDetails,
  appOrigin: () => getCanonicalAppUrl().origin,
};

export type WorkObjectDeps = typeof defaultDeps;

async function mogplexUserFor(
  deps: WorkObjectDeps,
  teamId: string,
  slackUserId: string | undefined
) {
  if (!slackUserId) return null;
  const installation = await deps.getInstallation(teamId);
  if (!installation) return null;
  const mapping = await deps.getUserMapping({
    installationId: installation.id,
    slackUserId,
  });
  return resolveSlackCommandUserId(installation, mapping, slackUserId);
}

/**
 * Who may see a run's Work Object: its owner, anywhere; anyone else only in
 * the conversation that already shows the run's card. A run link shared
 * elsewhere by someone else stays a plain link, so pasting a run id never
 * reveals a run to people who could not already see it.
 */
function canSeeRun(input: {
  run: ExternalAgentRunRow;
  mogplexUserId: string | null;
  teamId: string;
  channelId: string | undefined;
}) {
  if (input.mogplexUserId && input.mogplexUserId === input.run.user_id)
    return true;
  const card = readSlackRunControlsMetadata(input.run.metadata);
  return Boolean(
    card &&
    input.channelId &&
    card.teamId === input.teamId &&
    card.channelId === input.channelId
  );
}

export type LinkSharedOutcome = "ignored" | "not_visible" | "unfurled";

/** link_shared: unfurl run links as Work Objects (chat.unfurl). */
export async function handleLinkShared(
  teamId: string,
  event: SlackLinkSharedEvent,
  overrides: Partial<WorkObjectDeps> = {}
): Promise<LinkSharedOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  const origin = deps.appOrigin();
  const runLinks = new Map<string, string>();
  for (const link of event.links ?? []) {
    const runId = link.url ? parseRunLink(link.url, origin) : null;
    if (link.url && runId && !runLinks.has(link.url))
      runLinks.set(link.url, runId);
  }
  if (runLinks.size === 0) return "ignored";
  const target =
    event.unfurl_id && event.source
      ? { unfurl_id: event.unfurl_id, source: event.source }
      : event.channel && event.message_ts
        ? { channel: event.channel, ts: event.message_ts }
        : null;
  if (!target) return "ignored";
  const botToken = await deps.getBotToken(teamId);
  if (!botToken) return "ignored";

  const mogplexUserId = await mogplexUserFor(deps, teamId, event.user);
  const entities = [];
  for (const [url, runId] of [...runLinks].slice(0, MAX_UNFURLS)) {
    const run = await deps.loadRun(runId);
    if (!run) continue;
    if (!canSeeRun({ run, mogplexUserId, teamId, channelId: event.channel }))
      continue;
    const repoFullName = await deps.loadRepoName(run).catch(() => null);
    entities.push(buildRunWorkObject({ run, repoFullName, appUnfurlUrl: url }));
  }
  if (entities.length === 0) return "not_visible";
  await deps.unfurl(botToken, { ...target, metadata: { entities } });
  return "unfurled";
}

export type EntityDetailsOutcome =
  | "ignored"
  | "not_found"
  | "restricted"
  | "presented";

/** entity_details_requested: fill the flexpane for one viewer. */
export async function handleEntityDetailsRequested(
  teamId: string,
  event: SlackEntityDetailsRequestedEvent,
  overrides: Partial<WorkObjectDeps> = {}
): Promise<EntityDetailsOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  const triggerId = event.trigger_id;
  if (!triggerId) return "ignored";
  const fromRef = event.external_ref?.id?.trim();
  const runId =
    fromRef && isUuid(fromRef)
      ? fromRef.toLowerCase()
      : event.entity_url
        ? parseRunLink(event.entity_url, deps.appOrigin())
        : null;
  const botToken = await deps.getBotToken(teamId);
  if (!botToken) return "ignored";
  if (!runId) {
    await deps.presentDetails(botToken, {
      trigger_id: triggerId,
      error: { status: "not_found" },
    });
    return "not_found";
  }
  const [run, mogplexUserId] = await Promise.all([
    deps.loadRun(runId),
    mogplexUserFor(deps, teamId, event.user),
  ]);
  // A missing run and a hidden one answer the same way.
  if (
    !run ||
    !canSeeRun({ run, mogplexUserId, teamId, channelId: event.channel })
  ) {
    await deps.presentDetails(botToken, {
      trigger_id: triggerId,
      error: { status: "restricted" },
    });
    return "restricted";
  }
  const repoFullName = await deps.loadRepoName(run).catch(() => null);
  await deps.presentDetails(botToken, {
    trigger_id: triggerId,
    metadata: buildRunWorkObject({ run, repoFullName }),
  });
  return "presented";
}

/** Route a Work Object event. Never throws. */
export async function handleSlackWorkObjectEvent(
  teamId: string,
  event: { type: string }
): Promise<void> {
  try {
    if (event.type === "link_shared")
      await handleLinkShared(teamId, event as SlackLinkSharedEvent);
    else if (event.type === "entity_details_requested")
      await handleEntityDetailsRequested(
        teamId,
        event as SlackEntityDetailsRequestedEvent
      );
  } catch (error) {
    console.error("[slack-work-objects] event failed", {
      type: event.type,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
