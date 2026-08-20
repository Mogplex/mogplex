import type {
  ResourceDecisionSource,
  ResourceRejectionReason,
} from "@/lib/agents/orchestrator/resource-telemetry";
import {
  loadOwnedSandboxRouteRecord,
  type LoadedSandboxRouteRecord,
  type SandboxRouteFailure,
} from "@/lib/sandbox/route-context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ControlChatRequestBody } from "./types";

type ControlPromptSandboxRecord = {
  id: string;
  sandbox_id: string;
  repo_id: string;
  working_branch: string;
  status: string;
};

type ControlPromptSandboxDeps = {
  loadSandboxRecord: (
    request: Request,
    sandboxId: string,
    options: { select: string }
  ) => Promise<
    LoadedSandboxRouteRecord<ControlPromptSandboxRecord> | SandboxRouteFailure
  >;
  listRepoSandboxes: (input: {
    userId: string;
    repoId: string;
  }) => Promise<ControlPromptSandboxRecord[]>;
  warn?: (message: string, context: Record<string, unknown>) => void;
};

const defaultControlPromptSandboxDeps: ControlPromptSandboxDeps = {
  loadSandboxRecord: (request, sandboxId, options) =>
    loadOwnedSandboxRouteRecord<ControlPromptSandboxRecord>(
      request,
      sandboxId,
      options
    ),
  async listRepoSandboxes(input) {
    const { data, error } = await supabaseAdmin
      .from("sandboxes")
      .select("id, sandbox_id, repo_id, working_branch, status")
      .eq("user_id", input.userId)
      .eq("repo_id", input.repoId)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  },
  warn: (message, context) => console.warn(message, context),
};

export type ControlPromptSandboxContext = {
  decisionSource: ResourceDecisionSource;
  rejectionReason: ResourceRejectionReason | null;
  selectionRequired: boolean;
  selected: {
    recordId: string;
    runtimeId: string;
  } | null;
  sandboxes: Array<{ id: string; branch: string; status: string }>;
};

function presentPromptSandbox(record: ControlPromptSandboxRecord) {
  return {
    id: record.id,
    branch: record.working_branch,
    status: record.status,
  };
}

function selectedPromptSandbox(record: ControlPromptSandboxRecord) {
  return {
    recordId: record.id,
    runtimeId: record.sandbox_id,
  };
}

function sandboxLoadRejection(status: number): ResourceRejectionReason {
  return status === 404 || status === 410
    ? "sandbox_not_found"
    : "sandbox_unavailable";
}

/** Exactly one validated record may become the selected tool sandbox. */
export function resolveSelectedControlSandboxId(
  sandboxes: ReadonlyArray<{ id: string }>
): string | null {
  return sandboxes.length === 1 ? (sandboxes[0]?.id ?? null) : null;
}

/** Convert validated prompt context into the sandbox identity tools may use. */
export function resolveControlToolSandboxId(
  context: ControlPromptSandboxContext
): string | null {
  if (context.selectionRequired) return null;
  return (
    context.selected?.recordId ??
    resolveSelectedControlSandboxId(
      context.sandboxes.filter((sandbox) => sandbox.status === "running")
    )
  );
}

/**
 * Hydrate running repo sandboxes and validate any client selection hint.
 * Ambiguous or failed lookups require an explicit selection and disable tool
 * fallback; a validated hint remains authoritative even when other VMs run.
 */
export async function resolveControlPromptSandboxContext(
  request: Request,
  userId: string,
  body: ControlChatRequestBody,
  deps: ControlPromptSandboxDeps = defaultControlPromptSandboxDeps
): Promise<ControlPromptSandboxContext> {
  const empty: ControlPromptSandboxContext = {
    decisionSource: "none",
    rejectionReason: null,
    selectionRequired: false,
    selected: null,
    sandboxes: [],
  };
  const warn = deps.warn ?? (() => {});
  if (!body.repoId) {
    return body.sandboxId
      ? {
          ...empty,
          selectionRequired: true,
          rejectionReason: "repo_not_selected",
        }
      : empty;
  }

  let repoSandboxes: ControlPromptSandboxRecord[];
  try {
    repoSandboxes = await deps.listRepoSandboxes({
      userId,
      repoId: body.repoId,
    });
  } catch (error) {
    warn("[control] sandbox inventory unavailable", {
      repoId: body.repoId,
      error,
    });
    if (!body.sandboxId) {
      return {
        ...empty,
        selectionRequired: true,
        rejectionReason: "sandbox_lookup_failed",
      };
    }
    repoSandboxes = [];
  }

  if (!body.sandboxId) {
    const sandboxes = repoSandboxes.map(presentPromptSandbox);
    if (repoSandboxes.length > 1) {
      return {
        ...empty,
        selectionRequired: true,
        rejectionReason: "multiple_sandboxes",
        sandboxes,
      };
    }
    const selected = repoSandboxes[0];
    return selected
      ? {
          decisionSource: "server_selected",
          rejectionReason: null,
          selectionRequired: false,
          selected: selectedPromptSandbox(selected),
          sandboxes,
        }
      : empty;
  }

  let loaded:
    | LoadedSandboxRouteRecord<ControlPromptSandboxRecord>
    | SandboxRouteFailure;
  try {
    loaded = await deps.loadSandboxRecord(request, body.sandboxId, {
      select: "id, sandbox_id, repo_id, working_branch, status",
    });
  } catch (error) {
    warn("[control] sandbox prompt context lookup threw", {
      sandboxId: body.sandboxId,
      repoId: body.repoId,
      error,
    });
    return {
      ...empty,
      selectionRequired: true,
      rejectionReason: "sandbox_lookup_failed",
      sandboxes: repoSandboxes.map(presentPromptSandbox),
    };
  }

  if (!loaded.ok) {
    warn("[control] sandbox prompt context unavailable", {
      sandboxId: body.sandboxId,
      repoId: body.repoId,
      status: loaded.status,
      error: loaded.error,
    });
    return {
      ...empty,
      selectionRequired: true,
      rejectionReason: sandboxLoadRejection(loaded.status),
      sandboxes: repoSandboxes.map(presentPromptSandbox),
    };
  }
  if (loaded.record.repo_id !== body.repoId) {
    warn("[control] sandbox prompt context repo mismatch", {
      sandboxId: body.sandboxId,
      repoId: body.repoId,
      sandboxRepoId: loaded.record.repo_id,
    });
    return {
      ...empty,
      selectionRequired: true,
      rejectionReason: "repo_mismatch",
      sandboxes: repoSandboxes.map(presentPromptSandbox),
    };
  }

  if (loaded.record.status !== "running") {
    return {
      decisionSource: "server_validated_request",
      rejectionReason: "sandbox_inactive",
      selectionRequired: false,
      selected: null,
      sandboxes: [presentPromptSandbox(loaded.record)],
    };
  }

  return {
    decisionSource: "server_validated_request",
    rejectionReason: null,
    selectionRequired: false,
    selected: selectedPromptSandbox(loaded.record),
    sandboxes: [presentPromptSandbox(loaded.record)],
  };
}

/** Backwards-compatible prompt-only view of the validated sandbox context. */
export async function resolveControlPromptSandboxes(
  request: Request,
  userId: string,
  body: ControlChatRequestBody,
  deps: ControlPromptSandboxDeps = defaultControlPromptSandboxDeps
) {
  return (await resolveControlPromptSandboxContext(request, userId, body, deps))
    .sandboxes;
}
