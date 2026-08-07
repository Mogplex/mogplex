import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { coerceGraph, getEntryAgentIds } from "@/lib/flows/graph";
import type { WebhookFlowRow, WebhookRepoRow } from "./types";

function getPublishedFlowVersionInternal(flow: WebhookFlowRow) {
  return Array.isArray(flow.published_version)
    ? (flow.published_version[0] ?? null)
    : flow.published_version;
}

export function collectFlowAgentIds(flows: WebhookFlowRow[]) {
  return Array.from(
    new Set(
      flows.flatMap((flow) => {
        const publishedVersion = getPublishedFlowVersionInternal(flow);
        if (!publishedVersion) {
          return [];
        }

        return getEntryAgentIds(coerceGraph(publishedVersion.graph));
      })
    )
  );
}

function uniqueWebhookUserIds(
  rows: Array<{ user_id?: string | null }>
): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
}

export async function loadWebhookRepoRows(
  repoGithubId: number | null,
  installationId: number | null
) {
  if (!repoGithubId) {
    return [];
  }

  let repoQuery = supabaseAdmin
    .from("repos")
    .select("*")
    .eq("github_id", repoGithubId);

  if (installationId) {
    repoQuery = repoQuery.eq("github_installation_id", installationId);
  }

  const { data } = await repoQuery;
  return (data || []) as WebhookRepoRow[];
}

export async function loadFlowAgentSlugMap(
  agentIds: string[],
  installationId: number
) {
  const { data: agents, error } =
    agentIds.length > 0
      ? await supabaseAdmin.from("agents").select("id, slug").in("id", agentIds)
      : { data: [], error: null };

  if (error) {
    console.error("Failed to load flow routing agents:", {
      installationId,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Failed to load flow agents" },
      { status: 500 }
    );
  }

  return new Map(
    (agents || []).map((agent) => [
      agent.id as string,
      (agent.slug as string | null) ?? null,
    ])
  );
}

export async function loadWebhookFlowUserIds(input: {
  repoRows: WebhookRepoRow[];
  installationId: number | null;
}) {
  const repoUserIds = uniqueWebhookUserIds(input.repoRows);
  if (repoUserIds.length > 0) {
    return repoUserIds;
  }

  if (!input.installationId) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("github_installations")
    .select("user_id")
    .eq("installation_id", input.installationId);

  if (error) {
    console.error("Failed to load flow routing users:", {
      installationId: input.installationId,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Failed to load flow routing users" },
      { status: 500 }
    );
  }

  return uniqueWebhookUserIds(data || []);
}

export async function loadWebhookFlows(userIds: string[]) {
  const { data: flows, error } = await supabaseAdmin
    .from("flows")
    .select(
      "id, user_id, installation_id, published_version_id, published_version:flow_versions!flows_published_version_id_fkey(id, graph)"
    )
    .in("user_id", userIds)
    .eq("status", "active")
    .not("published_version_id", "is", null);

  if (error) {
    return { flows: null, error };
  }

  return { flows: (flows || []) as WebhookFlowRow[], error: null };
}
