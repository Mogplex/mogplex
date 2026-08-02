import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  WORKSPACE_COLUMNS,
  normalizeWorkspaceSettings,
} from "@/lib/workspaces";
import { buildUnknownVercelLinkState } from "@/lib/vercel/reconciliation";
import {
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import {
  applyResourceOwnerScope,
  buildResourceOwnershipInsert,
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";

type WorkspaceListItem = {
  id: string;
  user_id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  sandbox_billing_mode?: "platform" | "user_vercel_project";
  sandbox_timeout_ms?: number | null;
  sandbox_vercel_project_id?: string | null;
  sandbox_vercel_team_id?: string | null;
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
  repo_count?: number;
};

type WorkspacesRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  loadWorkspaces: (scope: ProductResourceScope) => Promise<WorkspaceListItem[]>;
  loadRepoWorkspaceIds: (
    scope: ProductResourceScope
  ) => Promise<Array<{ workspace_id: string | null }>>;
  insertWorkspace: (payload: {
    user_id: string;
    owner_type: "user" | "team";
    owner_user_id: string | null;
    product_team_id: string | null;
    created_by_user_id: string | null;
    name: string;
    description: string | null;
    is_default?: boolean;
    sandbox_billing_mode: "platform" | "user_vercel_project";
    sandbox_timeout_ms: number;
    sandbox_vercel_project_id: string | null;
    sandbox_vercel_team_id: string | null;
    vercel_link_status:
      | "unknown"
      | "valid"
      | "missing_project"
      | "auth_invalid"
      | "inaccessible";
    vercel_link_checked_at: string | null;
    vercel_link_error_code: string | null;
    vercel_link_message: string | null;
  }) => Promise<{
    data: WorkspaceListItem | null;
    error: { code?: string; message: string } | null;
  }>;
};

async function loadWorkspaces(scope: ProductResourceScope) {
  let query = supabaseAdmin
    .from("workspaces")
    .select(WORKSPACE_COLUMNS)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load workspaces: ${error.message}`);
  }

  return (data || []) as WorkspaceListItem[];
}

async function loadRepoWorkspaceIds(scope: ProductResourceScope) {
  let query = supabaseAdmin.from("repos").select("workspace_id");
  query = applyResourceOwnerScope(query, scope);
  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load workspace repo counts: ${error.message}`);
  }

  return (data || []) as Array<{ workspace_id: string | null }>;
}

async function insertWorkspace(payload: {
  user_id: string;
  owner_type: "user" | "team";
  owner_user_id: string | null;
  product_team_id: string | null;
  created_by_user_id: string | null;
  name: string;
  description: string | null;
  is_default?: boolean;
  sandbox_billing_mode: "platform" | "user_vercel_project";
  sandbox_timeout_ms: number;
  sandbox_vercel_project_id: string | null;
  sandbox_vercel_team_id: string | null;
  vercel_link_status:
    | "unknown"
    | "valid"
    | "missing_project"
    | "auth_invalid"
    | "inaccessible";
  vercel_link_checked_at: string | null;
  vercel_link_error_code: string | null;
  vercel_link_message: string | null;
}) {
  return supabaseAdmin
    .from("workspaces")
    .insert({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .select(WORKSPACE_COLUMNS)
    .single();
}

function withRepoCounts(
  workspaces: WorkspaceListItem[],
  repoWorkspaceIds: Array<{ workspace_id: string | null }>
) {
  const counts = new Map<string, number>();
  for (const repo of repoWorkspaceIds) {
    if (!repo.workspace_id) continue;
    counts.set(repo.workspace_id, (counts.get(repo.workspace_id) || 0) + 1);
  }

  return workspaces.map((workspace) => ({
    ...workspace,
    repo_count: counts.get(workspace.id) || 0,
  }));
}

export function createWorkspacesGetHandler(
  overrides: Partial<WorkspacesRouteDeps> = {}
) {
  const deps: WorkspacesRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    loadWorkspaces,
    loadRepoWorkspaceIds,
    insertWorkspace,
    ...overrides,
  };

  return async function GET(
    request: Request = new Request("http://localhost/api/workspaces")
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const scopeResolution = await resolveProductResourceScope({
      request,
      userId,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }
    const { scope } = scopeResolution;

    const [workspaces, repoWorkspaceIds] = await Promise.all([
      deps.loadWorkspaces(scope),
      deps.loadRepoWorkspaceIds(scope),
    ]);

    return NextResponse.json(withRepoCounts(workspaces, repoWorkspaceIds));
  };
}

export function createWorkspacesPostHandler(
  overrides: Partial<WorkspacesRouteDeps> = {}
) {
  const deps: WorkspacesRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    loadWorkspaces,
    loadRepoWorkspaceIds,
    insertWorkspace,
    ...overrides,
  };

  return async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

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

    const body = await req.json();
    const settings = normalizeWorkspaceSettings(body);
    const {
      name,
      description,
      sandbox_billing_mode,
      sandbox_vercel_project_id,
      sandbox_vercel_team_id,
    } = settings;
    const { sandbox_timeout_ms } = settings;
    if (!name) {
      return NextResponse.json(
        { error: "Workspace name is required" },
        { status: 400 }
      );
    }

    const { data, error } = await deps.insertWorkspace({
      ...buildResourceOwnershipInsert(scope),
      name,
      description,
      sandbox_billing_mode,
      sandbox_timeout_ms,
      sandbox_vercel_project_id,
      sandbox_vercel_team_id,
      ...buildUnknownVercelLinkState(),
    });

    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "A project with that name already exists" },
        { status: 409 }
      );
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ...data,
      repo_count: 0,
    });
  };
}

export const GET = createWorkspacesGetHandler();
export const POST = createWorkspacesPostHandler();
