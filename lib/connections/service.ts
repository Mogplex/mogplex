import { supabaseAdmin } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "./encryption";
import { MAX_MCP_CONNECTIONS } from "./constants";
import type { Connection, ConnectionOverride } from "@/lib/types";

const CONNECTION_COLUMNS =
  "id, user_id, name, type, base_url, auth_type, auth_header, mcp_transport, mcp_url, description, is_enabled, health_status, scope, repo_id, oauth_client_id, oauth_authorize_url, oauth_token_url, oauth_scopes, oauth_authorized_at, oauth_token_expires_at, source_preset, last_tested_at, last_test_error, last_test_http_status, last_test_tool_count, created_at, updated_at";

async function fetchRepoConnectionData(userId: string, repoId: string) {
  const [globalResult, projectResult, overrideResult] = await Promise.all([
    supabaseAdmin
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("user_id", userId)
      .eq("scope", "global")
      .order("created_at"),
    supabaseAdmin
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("user_id", userId)
      .eq("scope", "project")
      .eq("repo_id", repoId)
      .order("created_at"),
    supabaseAdmin
      .from("repo_connection_overrides")
      .select("id, repo_id, connection_id, excluded, created_at")
      .eq("repo_id", repoId),
  ]);

  if (globalResult.error) throw new Error(globalResult.error.message);
  if (projectResult.error) throw new Error(projectResult.error.message);
  if (overrideResult.error) throw new Error(overrideResult.error.message);

  return {
    globalConnections: (globalResult.data ?? []) as Connection[],
    projectConnections: (projectResult.data ?? []) as Connection[],
    overrides: (overrideResult.data ?? []) as ConnectionOverride[],
  };
}

function applyMcpCap(connections: Connection[]): Connection[] {
  const restApis = connections.filter((c) => c.type === "rest_api");
  const mcpServers = connections.filter((c) => c.type === "mcp_server");

  if (mcpServers.length <= MAX_MCP_CONNECTIONS) {
    return connections;
  }

  const sortedMcps = [...mcpServers].sort((a, b) => {
    if (a.scope === "project" && b.scope !== "project") return -1;
    if (a.scope !== "project" && b.scope === "project") return 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return [...restApis, ...sortedMcps.slice(0, MAX_MCP_CONNECTIONS)];
}

export function resolveRepoConnections(
  globalConnections: Connection[],
  projectConnections: Connection[],
  overrides: ConnectionOverride[]
) {
  const excludedSet = new Set(
    overrides
      .filter((o) => o.excluded && o.connection_id)
      .map((o) => o.connection_id!)
  );

  const filteredGlobal = globalConnections.filter(
    (c) => c.is_enabled && !excludedSet.has(c.id)
  );
  const enabledProjectConnections = projectConnections.filter(
    (c) => c.is_enabled
  );
  const resolvedConnections = applyMcpCap([
    ...filteredGlobal,
    ...enabledProjectConnections,
  ]);

  return { resolvedConnections, excludedSet };
}

export async function getUserConnections(
  userId: string
): Promise<Connection[]> {
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .eq("is_enabled", true)
    .order("created_at");

  if (error) throw new Error(error.message);
  return (data ?? []) as Connection[];
}

export async function getAllUserConnections(
  userId: string
): Promise<Connection[]> {
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return (data ?? []) as Connection[];
}

export async function findUserConnectionBySourcePreset(
  userId: string,
  sourcePreset: string
): Promise<Connection | null> {
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .eq("source_preset", sourcePreset)
    .order("created_at")
    .limit(1);

  if (error) throw new Error(error.message);
  return ((data ?? []) as Connection[])[0] ?? null;
}

/** Resolve runnable connections for a repo: enabled global (minus excluded) + enabled project, with MCP cap */
export async function getResolvedConnections(
  userId: string,
  repoId: string
): Promise<Connection[]> {
  const { globalConnections, projectConnections, overrides } =
    await fetchRepoConnectionData(userId, repoId);
  return resolveRepoConnections(
    globalConnections,
    projectConnections,
    overrides
  ).resolvedConnections;
}

export async function getRepoConnectionsForDisplay(
  userId: string,
  repoId: string
): Promise<{
  connections: Connection[];
  overrides: ConnectionOverride[];
  resolvedMcpCount: number;
}> {
  const { globalConnections, projectConnections, overrides } =
    await fetchRepoConnectionData(userId, repoId);
  const { resolvedConnections } = resolveRepoConnections(
    globalConnections,
    projectConnections,
    overrides
  );

  return {
    connections: [...globalConnections, ...projectConnections],
    overrides,
    resolvedMcpCount: resolvedConnections.filter((c) => c.type === "mcp_server")
      .length,
  };
}

/** Count resolved MCP connections for a user+repo (lightweight query for validation) */
export async function countResolvedMcps(
  userId: string,
  repoId: string
): Promise<number> {
  const conns = await getResolvedConnections(userId, repoId);
  return conns.filter((c) => c.type === "mcp_server").length;
}

export async function getConnectionCredentials(
  connectionId: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select("encrypted_credentials")
    .eq("id", connectionId)
    .single();

  if (error) throw new Error(error.message);
  if (!data?.encrypted_credentials) return "";
  return decrypt(data.encrypted_credentials);
}

export async function createConnection(
  userId: string,
  input: {
    name: string;
    type: "rest_api" | "mcp_server";
    base_url?: string;
    auth_type?: string;
    auth_header?: string;
    mcp_transport?: string;
    mcp_url?: string;
    credentials?: string;
    description?: string;
    scope?: "global" | "project";
    repo_id?: string;
    oauth_client_id?: string | null;
    oauth_authorize_url?: string | null;
    oauth_token_url?: string | null;
    oauth_scopes?: string | null;
    oauth_authorized_at?: string | null;
    oauth_token_expires_at?: string | null;
    source_preset?: string;
  }
): Promise<Connection> {
  const { credentials, ...rest } = input;
  const encrypted_credentials = credentials ? encrypt(credentials) : null;

  const { data, error } = await supabaseAdmin
    .from("connections")
    .insert({ ...rest, user_id: userId, encrypted_credentials })
    .select(CONNECTION_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as Connection;
}

export async function upsertConnectionBySourcePreset(
  userId: string,
  input: {
    source_preset: string;
    name: string;
    type: "rest_api" | "mcp_server";
    auth_type?: string;
    auth_header?: string;
    mcp_transport?: string;
    mcp_url?: string;
    credentials?: string;
    description?: string;
    oauth_client_id?: string | null;
    oauth_authorize_url?: string | null;
    oauth_token_url?: string | null;
    oauth_scopes?: string | null;
    oauth_authorized_at?: string | null;
    oauth_token_expires_at?: string | null;
  }
): Promise<string> {
  const { credentials, ...rest } = input;
  const encryptedCredentials = credentials ? encrypt(credentials) : null;
  const { data, error } = await supabaseAdmin.rpc(
    "upsert_connection_by_source_preset",
    {
      p_user_id: userId,
      p_source_preset: input.source_preset,
      p_name: input.name,
      p_type: input.type,
      p_auth_type: input.auth_type ?? null,
      p_auth_header: input.auth_header ?? null,
      p_mcp_transport: input.mcp_transport ?? null,
      p_mcp_url: input.mcp_url ?? null,
      p_encrypted_credentials: encryptedCredentials,
      p_description: input.description ?? null,
      p_oauth_client_id: input.oauth_client_id ?? null,
      p_oauth_authorize_url: input.oauth_authorize_url ?? null,
      p_oauth_token_url: input.oauth_token_url ?? null,
      p_oauth_scopes: input.oauth_scopes ?? null,
      p_oauth_authorized_at: input.oauth_authorized_at ?? null,
      p_oauth_token_expires_at: input.oauth_token_expires_at ?? null,
    }
  );

  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) {
    throw new Error(
      `upsert_connection_by_source_preset did not return a connection id for ${rest.source_preset}`
    );
  }

  return data;
}

export async function updateConnection(
  connectionId: string,
  input: {
    name?: string;
    base_url?: string;
    auth_type?: string;
    auth_header?: string;
    mcp_transport?: string;
    mcp_url?: string;
    credentials?: string;
    description?: string;
    is_enabled?: boolean;
    scope?: "global" | "project";
    repo_id?: string;
    oauth_client_id?: string | null;
    oauth_authorize_url?: string | null;
    oauth_token_url?: string | null;
    oauth_scopes?: string | null;
    oauth_authorized_at?: string | null;
    oauth_token_expires_at?: string | null;
  }
): Promise<void> {
  const { credentials, ...rest } = input;
  const update: Record<string, unknown> = {
    ...rest,
    updated_at: new Date().toISOString(),
  };
  if (credentials !== undefined) {
    update.encrypted_credentials = credentials ? encrypt(credentials) : null;
  }

  const { error } = await supabaseAdmin
    .from("connections")
    .update(update)
    .eq("id", connectionId);

  if (error) throw new Error(error.message);
}

export async function deleteConnection(connectionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("connections")
    .delete()
    .eq("id", connectionId);

  if (error) throw new Error(error.message);
}
