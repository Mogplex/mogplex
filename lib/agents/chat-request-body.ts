import type { Repo, SandboxRecord } from "@/lib/types";

type ChatRepoContext =
  | (Pick<Repo, "id" | "full_name" | "default_branch"> & {
      working_branch?: string | null;
    })
  | null
  | undefined;
type ChatSandboxContext = Pick<SandboxRecord, "id"> | null | undefined;

export function buildChatRequestBody(
  model: string,
  repo?: ChatRepoContext,
  sandbox?: ChatSandboxContext,
  conversationId?: string,
  workspaceSessionId?: string
) {
  const [repoOwner, repoName] = repo?.full_name?.split("/") ?? [];

  return {
    model,
    conversationId,
    workspaceSessionId,
    sandboxId: sandbox?.id,
    repoId: repo?.id,
    repoFullName: repo?.full_name,
    repoOwner,
    repoName,
    repoBranch: repo?.working_branch || repo?.default_branch || "main",
    repoBaseBranch: repo?.default_branch || "main",
  };
}
