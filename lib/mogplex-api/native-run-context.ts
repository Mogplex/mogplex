import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSlackBotToken } from "@/lib/slack/client";
import {
  normalizeSlackRunImageAttachmentsMetadata,
  SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY,
} from "@/lib/slack/run-attachments";
import {
  prepareSlackAttachments,
  buildSlackUserMessage,
} from "@/trigger/slack-event-lib/attachments";
import type { ExternalAgentRunRow } from "./runs-types";
import type { SandboxRef } from "./run-execution-launch";

type NativeSandboxRecord = {
  id: string;
  user_id: string;
  repo_id: string;
  sandbox_id: string;
  status: string;
  product_team_id: string | null;
  working_branch: string;
  base_branch: string;
  repo: { full_name: string } | { full_name: string }[] | null;
};

async function loadNativeSandboxRecord(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef
): Promise<NativeSandboxRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, user_id, repo_id, product_team_id, sandbox_id, working_branch, base_branch, status, repo:repos(full_name)"
    )
    .eq("id", sandbox.recordId)
    .eq("user_id", run.user_id)
    .eq("repo_id", run.repo_id)
    .single();
  if (error) throw new Error("Active sandbox not found for this agent run");
  return data as unknown as NativeSandboxRecord | null;
}

export async function loadNativeRunContext(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef,
  loadRecord = loadNativeSandboxRecord
) {
  const row = await loadRecord(run, sandbox);
  if (
    row?.status !== "running" ||
    row.id !== sandbox.recordId ||
    row.user_id !== run.user_id ||
    row.repo_id !== run.repo_id ||
    row.working_branch !== run.working_branch ||
    row.sandbox_id !== sandbox.sandboxId
  ) {
    throw new Error("Active sandbox not found for this agent run");
  }
  const repo = Array.isArray(row.repo) ? row.repo[0] : row.repo;
  if (!repo?.full_name)
    throw new Error("Repository not found for this agent run");
  const [repoOwner, repoName] = repo.full_name.split("/");
  return {
    userId: run.user_id,
    repoId: run.repo_id,
    repoFullName: repo.full_name,
    repoOwner,
    repoName,
    repoBranch: row.working_branch,
    repoBaseBranch: row.base_branch,
    sandboxId: row.id,
    teamId: row.product_team_id,
    conversationId: run.conversation_id,
    workspaceSessionId: run.workspace_session_id,
    // This is the full repo agent; the Slack router intentionally hides bash.
    surface: "chat" as const,
    enableTools: true,
    latestUserText: run.prompt,
    toolExecutionIdempotencyKey: run.ai_call_id,
  };
}

const defaultMessageDeps = { getToken: getSlackBotToken, fetch };

export async function buildNativeRunMessages(
  run: ExternalAgentRunRow,
  deps = defaultMessageDeps
) {
  const metadata = normalizeSlackRunImageAttachmentsMetadata(
    run.metadata[SLACK_RUN_IMAGE_ATTACHMENTS_METADATA_KEY]
  );
  if (!metadata)
    return [
      {
        role: "user" as const,
        parts: [{ type: "text" as const, text: run.prompt }],
      },
    ];
  const botToken = await deps.getToken(metadata.teamId);
  if (!botToken)
    throw new Error(
      "Slack image access is unavailable. Reconnect Slack and retry."
    );
  const attachments = await prepareSlackAttachments({
    botToken,
    payload: {
      attachments: metadata.files,
      attachmentDroppedCount: metadata.droppedCount,
    },
    deps: {
      fetchAttachment: ({ botToken: token, url, signal }) =>
        deps.fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
          signal,
        }),
    },
  });
  const message = buildSlackUserMessage({
    text: run.prompt,
    attachments,
  }).agent;
  return [
    {
      role: "user" as const,
      parts:
        typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : message.content,
    },
  ];
}
