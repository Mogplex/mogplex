import type { ComposerSendOptions } from "./composer";

export type ControlChatRequestContext = {
  conversationId?: string | null;
  missionId?: string | null;
  missionTitle?: string | null;
  repoId?: string | null;
  repoFullName?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  repoBaseBranch?: string | null;
  sandboxId?: string | null;
};

export function buildControlChatMessage(
  text: string,
  options: ComposerSendOptions
) {
  if (!text.trim()) {
    return { files: options.files };
  }

  return {
    text,
    ...(options.files.length > 0 ? { files: options.files } : {}),
  };
}

export function buildControlChatBody(
  input: {
    model: string | null;
    scope: string;
    target: string;
    permissions: string;
    mode: ComposerSendOptions["mode"];
  } & ControlChatRequestContext
) {
  return {
    model: input.model ?? undefined,
    scope: input.scope,
    target: input.target,
    permissions: input.permissions,
    mode: input.mode,
    conversationId: input.conversationId ?? null,
    missionId: input.missionId ?? null,
    missionTitle: input.missionTitle ?? null,
    repoId: input.repoId ?? null,
    repoFullName: input.repoFullName ?? null,
    repoOwner: input.repoOwner ?? null,
    repoName: input.repoName ?? null,
    repoBranch: input.repoBranch ?? null,
    repoBaseBranch: input.repoBaseBranch ?? null,
    sandboxId: input.sandboxId ?? null,
  };
}

export function describeAttachments(count: number) {
  if (count === 0) return "";
  return `\n\n${count} attachment${count === 1 ? "" : "s"} included.`;
}
