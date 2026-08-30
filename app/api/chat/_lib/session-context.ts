import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRepoForScope } from "@/lib/repos";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";
import type { ChatRequestBody } from "./types";

type ChatConversationContextRecord = {
  id: string;
  user_id: string;
  repo_id: string | null;
  workspace_session_id: string | null;
  sandbox_id: string | null;
  model: string;
};

type ChatRepoContextRecord = {
  id: string;
  full_name: string;
  owner: string | null;
  name: string | null;
  default_branch: string | null;
};

type ChatSandboxContextRecord = {
  id: string;
  repo_id: string | null;
  working_branch: string | null;
};

type ChatSessionContextDeps = {
  loadConversation: (input: {
    conversationId: string;
    userId: string;
  }) => Promise<ChatConversationContextRecord | null>;
  loadRepo: (input: {
    request: Request;
    repoId: string;
    userId: string;
  }) => Promise<ChatRepoContextRecord | null>;
  loadSandbox: (input: {
    sandboxId: string;
    userId: string;
  }) => Promise<ChatSandboxContextRecord | null>;
};

const defaultChatSessionContextDeps: ChatSessionContextDeps = {
  async loadConversation(input) {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("id, user_id, repo_id, workspace_session_id, sandbox_id, model")
      .eq("id", input.conversationId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as ChatConversationContextRecord | null;
  },
  async loadRepo(input) {
    const scope = await resolveProductResourceScope({
      request: input.request,
      userId: input.userId,
    });
    if (!scope.ok) {
      throw new ChatSessionContextError(scope.error, scope.status);
    }
    return getRepoForScope<ChatRepoContextRecord>(
      input.repoId,
      scope.scope,
      "id, full_name, owner, name, default_branch"
    );
  },
  async loadSandbox(input) {
    const { data, error } = await supabaseAdmin
      .from("sandboxes")
      .select("id, repo_id, working_branch")
      .eq("id", input.sandboxId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as ChatSandboxContextRecord | null;
  },
};

export class ChatSessionContextError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 500,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ChatSessionContextError";
  }
}

function clearProjectContext(body: ChatRequestBody): ChatRequestBody {
  return {
    ...body,
    repoId: null,
    repoFullName: null,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    repoBaseBranch: null,
    sandboxId: null,
  };
}

/** Replace browser-provided project hints with the owned saved conversation. */
export async function resolveChatSessionContext(
  request: Request,
  userId: string,
  body: ChatRequestBody,
  deps: ChatSessionContextDeps = defaultChatSessionContextDeps
): Promise<ChatRequestBody> {
  if (!body.conversationId) {
    throw new ChatSessionContextError("Conversation id is required.", 400);
  }

  let conversation: ChatConversationContextRecord | null;
  try {
    conversation = await deps.loadConversation({
      conversationId: body.conversationId,
      userId,
    });
  } catch (error) {
    throw new ChatSessionContextError(
      "Could not load the conversation context.",
      500,
      { cause: error }
    );
  }
  if (conversation?.user_id !== userId) {
    throw new ChatSessionContextError("Conversation not found.", 404);
  }

  const savedContext = {
    model: conversation.model,
    workspaceSessionId: conversation.workspace_session_id,
  };
  if (!conversation.repo_id) {
    return {
      ...clearProjectContext(body),
      ...savedContext,
    };
  }

  let repo: ChatRepoContextRecord | null;
  try {
    repo = await deps.loadRepo({
      request,
      repoId: conversation.repo_id,
      userId,
    });
  } catch (error) {
    if (error instanceof ChatSessionContextError) throw error;
    throw new ChatSessionContextError(
      "Could not load the conversation repository context.",
      500,
      { cause: error }
    );
  }
  if (repo?.id !== conversation.repo_id) {
    throw new ChatSessionContextError(
      "The conversation repository is no longer available.",
      404
    );
  }

  if (body.sandboxId && body.sandboxId !== conversation.sandbox_id) {
    throw new ChatSessionContextError(
      "The conversation sandbox is no longer available.",
      404
    );
  }

  let sandbox: ChatSandboxContextRecord | null = null;
  if (conversation.sandbox_id) {
    try {
      sandbox = await deps.loadSandbox({
        sandboxId: conversation.sandbox_id,
        userId,
      });
    } catch (error) {
      throw new ChatSessionContextError(
        "Could not load the conversation sandbox context.",
        500,
        { cause: error }
      );
    }
    if (sandbox?.repo_id !== repo.id) {
      throw new ChatSessionContextError(
        "The conversation sandbox is no longer available.",
        404
      );
    }
  }

  const [fallbackOwner, fallbackName] = repo.full_name.split("/");
  const baseBranch = repo.default_branch?.trim() || "main";
  return {
    ...body,
    ...savedContext,
    repoId: repo.id,
    repoFullName: repo.full_name,
    repoOwner: repo.owner?.trim() || fallbackOwner || null,
    repoName: repo.name?.trim() || fallbackName || null,
    repoBaseBranch: baseBranch,
    repoBranch: sandbox?.working_branch?.trim() || baseBranch,
    sandboxId: sandbox?.id ?? null,
  };
}
