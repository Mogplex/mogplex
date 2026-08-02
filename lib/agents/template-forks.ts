import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PreconfiguredAgentTemplate = (typeof PRECONFIGURED_AGENTS)[number];

type ResolveAgentTemplateForkRpcArgs = {
  p_user_id: string;
  p_source_template: string;
  p_name: string;
  p_model: string;
  p_system_prompt: string;
  p_description: string;
  p_category: string;
};

type ResolveAgentTemplateForkRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

export type ResolveAgentTemplateForkDeps = {
  resolveTemplateForkRpc?: (
    args: ResolveAgentTemplateForkRpcArgs
  ) => Promise<ResolveAgentTemplateForkRpcResult>;
  // Model to stamp on a NEWLY created fork instead of the template's static
  // default. Freeze-on-fork semantics mean this never touches existing forks.
  // SECURITY: must come from server-side catalog resolution
  // (resolveUserDefaultModelId / resolveStoredUserDefaultModelId), never from
  // request input — see the input contract on resolve_agent_template_fork.
  modelOverride?: string | null;
};

export function findPreconfiguredAgentTemplate(
  templateName: string
): PreconfiguredAgentTemplate | null {
  return (
    PRECONFIGURED_AGENTS.find((entry) => entry.name === templateName) ?? null
  );
}

export class AgentTemplateForkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AgentTemplateForkError";
  }
}

export async function resolveAgentTemplateFork(
  userId: string,
  template: PreconfiguredAgentTemplate,
  deps: ResolveAgentTemplateForkDeps = {}
): Promise<{ id: string } | null> {
  const resolveTemplateForkRpc =
    deps.resolveTemplateForkRpc ??
    (async (args: ResolveAgentTemplateForkRpcArgs) => {
      const { data, error } = await supabaseAdmin.rpc(
        "resolve_agent_template_fork",
        args
      );
      return { data, error };
    });

  const { data, error } = await resolveTemplateForkRpc({
    p_user_id: userId,
    p_source_template: template.name,
    p_name: template.name,
    p_model: deps.modelOverride || template.model,
    p_system_prompt: template.system_prompt,
    p_description: template.description,
    p_category: template.category,
  });

  if (error) {
    throw new AgentTemplateForkError(
      `Failed to resolve agent template: ${error.message}`,
      { cause: error }
    );
  }

  if (typeof data === "string" && data.length > 0) {
    return { id: data };
  }

  if (data == null) {
    // The SQL function raises an exception if the upsert does not return an
    // agent ID, so this branch is theoretically dead code. If it ever fires
    // (e.g. due to a future RPC wrapper that swallows exceptions), throw with
    // enough context for on-call to identify which template triggered the
    // null return — a silent null here would surface as a generic 500 with no
    // actionable server-side trace.
    throw new AgentTemplateForkError(
      "resolve_agent_template_fork returned null without an error",
      { cause: { p_source_template: template.name } }
    );
  }

  throw new AgentTemplateForkError(
    "resolve_agent_template_fork returned an unexpected result",
    { cause: { returnedType: typeof data } }
  );
}
