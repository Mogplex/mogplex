import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  WORKSPACE_COLUMNS,
  getWorkspaceForScope,
  normalizeWorkspaceSettings,
} from "@/lib/workspaces";
import {
  buildUnknownVercelLinkState,
  shouldResetWorkspaceVercelLinkState,
} from "@/lib/vercel/reconciliation";
import {
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import {
  applyResourceOwnerScope,
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";

type WorkspaceItem = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  sandbox_billing_mode?: "platform" | "user_vercel_project";
  sandbox_timeout_ms?: number | null;
  sandbox_vercel_team_id?: string | null;
  sandbox_vercel_project_id?: string | null;
  vercel_link_status?:
    | "unknown"
    | "valid"
    | "missing_project"
    | "auth_invalid"
    | "inaccessible";
  vercel_link_checked_at?: string | null;
  vercel_link_error_code?: string | null;
  vercel_link_message?: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  getWorkspaceForScope: typeof getWorkspaceForScope;
  updateWorkspace: (
    id: string,
    scope: ProductResourceScope,
    updates: Record<string, unknown>
  ) => Promise<{
    data: WorkspaceItem | null;
    error: { code?: string; message: string } | null;
  }>;
  loadWorkspaceRepoCount: (id: string) => Promise<number>;
  deleteWorkspace: (
    id: string,
    scope: ProductResourceScope
  ) => Promise<{ error: { message: string } | null }>;
  loadWorkspaceRepoCountForDelete: (id: string) => Promise<number>;
};

const defaultDeps: WorkspaceRouteDeps = {
  requireUserId,
  resolveActiveTeamCapabilities,
  getWorkspaceForScope,
  async updateWorkspace(id, scope, updates) {
    let query = supabaseAdmin.from("workspaces").update(updates).eq("id", id);
    query = applyResourceOwnerScope(query, scope);
    return query.select(WORKSPACE_COLUMNS).single();
  },
  async loadWorkspaceRepoCount(id) {
    const { count } = await supabaseAdmin
      .from("repos")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", id);

    return count || 0;
  },
  async deleteWorkspace(id, scope) {
    let query = supabaseAdmin.from("workspaces").delete().eq("id", id);
    query = applyResourceOwnerScope(query, scope);
    const { error } = await query;

    return { error };
  },
  async loadWorkspaceRepoCountForDelete(id) {
    const { count, error } = await supabaseAdmin
      .from("repos")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", id);

    if (error) {
      throw new Error(error.message);
    }
    return count || 0;
  },
};

export function createWorkspacePatchHandler(
  overrides: Partial<WorkspaceRouteDeps> = {}
) {
  const deps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const { id } = await params;

    const scopeResolution = await resolveProductResourceScope({
      request: req,
      userId,
      requiredCapability: TEAM_RESOURCE_WRITE_CAPABILITY,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }
    const { scope } = scopeResolution;

    const workspace = await deps.getWorkspaceForScope(id, scope, "id");
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const settings = normalizeWorkspaceSettings(body);
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if ("name" in body) {
      if (!settings.name) {
        return NextResponse.json(
          { error: "Workspace name is required" },
          { status: 400 }
        );
      }
      updates.name = settings.name;
    }
    if ("description" in body) {
      updates.description = settings.description;
    }
    if ("sandbox_billing_mode" in body) {
      updates.sandbox_billing_mode = settings.sandbox_billing_mode;
    }
    if ("sandbox_timeout_ms" in body) {
      updates.sandbox_timeout_ms = settings.sandbox_timeout_ms;
    }
    if ("sandbox_vercel_project_id" in body) {
      updates.sandbox_vercel_project_id = settings.sandbox_vercel_project_id;
    }
    if ("sandbox_vercel_team_id" in body) {
      updates.sandbox_vercel_team_id = settings.sandbox_vercel_team_id;
    }
    if (shouldResetWorkspaceVercelLinkState(body)) {
      Object.assign(updates, buildUnknownVercelLinkState());
    }

    const { data, error } = await deps.updateWorkspace(id, scope, updates);

    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "A project with that name already exists" },
        { status: 409 }
      );
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const count = await deps.loadWorkspaceRepoCount(id);

    return NextResponse.json({
      ...data,
      repo_count: count || 0,
    });
  };
}

export function createWorkspaceDeleteHandler(
  overrides: Partial<WorkspaceRouteDeps> = {}
) {
  const deps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const { id } = await params;

    const scopeResolution = await resolveProductResourceScope({
      request: _req,
      userId,
      requiredCapability: TEAM_RESOURCE_WRITE_CAPABILITY,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }
    const { scope } = scopeResolution;

    const workspace = await deps.getWorkspaceForScope<{
      id: string;
      is_default: boolean;
    }>(id, scope, "id, is_default");
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }
    if (workspace.is_default) {
      return NextResponse.json(
        { error: "The default imported project cannot be deleted" },
        { status: 409 }
      );
    }

    let repoCount: number;
    try {
      repoCount = await deps.loadWorkspaceRepoCountForDelete(id);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to load repo count",
        },
        { status: 500 }
      );
    }
    if ((repoCount || 0) > 0) {
      return NextResponse.json(
        { error: "Delete or move the repos in this project first" },
        { status: 409 }
      );
    }

    const { error } = await deps.deleteWorkspace(id, scope);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  };
}

export const PATCH = createWorkspacePatchHandler();
export const DELETE = createWorkspaceDeleteHandler();
