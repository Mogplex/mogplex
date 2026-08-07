import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  StringRecord,
  SupabaseLikeError,
  McpServerCreateInput,
} from "./mcp-servers/types";
import { McpServerValidationError } from "./mcp-servers/types";
import {
  asMcpServerRow,
  asMcpServerRows,
  normalizeStoredState,
  toWebRecord,
  toCliRecord,
  validateNoPlainSecretKeyConflicts,
  normalizeStringRecord,
} from "./mcp-servers/validation";
import { normalizeMcpServerUpdateInput } from "./mcp-servers/normalization";
import {
  uniqueSecretIds,
  resolveVaultSecrets,
  applySecretMutations,
  deleteSecret,
} from "./mcp-servers/secrets";

// Re-export public types and classes
export { McpServerValidationError } from "./mcp-servers/types";
export type {
  McpServerWebRecord,
  McpServerCliRecord,
  McpServerCreateInput,
} from "./mcp-servers/types";
export { normalizeMcpServerCreateInput } from "./mcp-servers/normalization";

const MCP_SERVER_COLUMNS = [
  "id",
  "user_id",
  "name",
  "enabled",
  "transport",
  "command",
  "args",
  "env_refs",
  "env_plain",
  "url",
  "header_refs",
  "header_plain",
  "extra",
  "created_at",
  "updated_at",
].join(", ");

function isNotFoundError(error: SupabaseLikeError | null) {
  return error?.code === "PGRST116";
}

function normalizeStorageError(error: SupabaseLikeError | null) {
  if (!error) return null;

  if (error.code === "23505") {
    return new McpServerValidationError(
      "A server with that name already exists",
      "DUPLICATE_NAME",
      409
    );
  }

  if (error.code === "23514") {
    return new McpServerValidationError(error.message);
  }

  return new Error(error.message);
}

async function selectUserMcpServerRow(userId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("user_mcp_servers")
    .select(MCP_SERVER_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw normalizeStorageError(error) ?? new Error(error.message);
  }

  return data ? normalizeStoredState(asMcpServerRow(data)) : null;
}

export async function listUserMcpServersForWeb(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_mcp_servers")
    .select(MCP_SERVER_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw normalizeStorageError(error) ?? new Error(error.message);
  }

  return asMcpServerRows(data ?? []).map((row) =>
    toWebRecord(normalizeStoredState(row))
  );
}

export async function listUserMcpServersForCli(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_mcp_servers")
    .select(MCP_SERVER_COLUMNS)
    .eq("user_id", userId)
    .order("created_at");

  if (error) {
    throw normalizeStorageError(error) ?? new Error(error.message);
  }

  const rows = asMcpServerRows(data ?? []).map(normalizeStoredState);
  const resolvedSecrets = await resolveVaultSecrets(uniqueSecretIds(rows));
  return rows.map((row) => toCliRecord(row, resolvedSecrets));
}

export async function getUserMcpServerForWeb(userId: string, id: string) {
  return selectUserMcpServerRow(userId, id).then((row) =>
    row ? toWebRecord(row) : null
  );
}

export async function createUserMcpServer(
  userId: string,
  input: McpServerCreateInput
) {
  const { data, error } = await supabaseAdmin
    .from("user_mcp_servers")
    .insert({
      user_id: userId,
      name: input.name,
      enabled: input.enabled,
      transport: input.transport,
      command: input.transport === "stdio" ? input.command : null,
      args: input.transport === "stdio" ? input.args : [],
      env_refs: {},
      env_plain: input.transport === "stdio" ? input.envPlain : {},
      url: input.transport === "http" ? input.url : null,
      header_refs: {},
      header_plain: input.transport === "http" ? input.headerPlain : {},
      extra: input.extra,
    })
    .select(MCP_SERVER_COLUMNS)
    .single();

  if (error) {
    throw normalizeStorageError(error) ?? new Error(error.message);
  }

  const createdRow = normalizeStoredState(asMcpServerRow(data));
  const createdSecretIds: string[] = [];

  try {
    let envRefs: StringRecord = {};
    let headerRefs: StringRecord = {};

    if (input.transport === "stdio") {
      envRefs = await applySecretMutations({
        userId,
        serverId: createdRow.id,
        slotPrefix: "env",
        currentRefs: {},
        operations: input.envSecrets,
        createdSecretIds,
      });
    } else {
      headerRefs = await applySecretMutations({
        userId,
        serverId: createdRow.id,
        slotPrefix: "header",
        currentRefs: {},
        operations: input.headerSecrets,
        createdSecretIds,
      });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("user_mcp_servers")
      .update({
        env_refs: envRefs,
        header_refs: headerRefs,
      })
      .eq("user_id", userId)
      .eq("id", createdRow.id)
      .select(MCP_SERVER_COLUMNS)
      .single();

    if (updateError) {
      throw (
        normalizeStorageError(updateError) ?? new Error(updateError.message)
      );
    }

    return toWebRecord(normalizeStoredState(asMcpServerRow(updated)));
  } catch (err) {
    await Promise.allSettled(
      createdSecretIds.map((secretId) => deleteSecret(secretId))
    );
    await supabaseAdmin
      .from("user_mcp_servers")
      .delete()
      .eq("user_id", userId)
      .eq("id", createdRow.id);
    throw err;
  }
}

export async function updateUserMcpServer(
  userId: string,
  id: string,
  input: unknown
) {
  const existing = await selectUserMcpServerRow(userId, id);
  if (!existing) {
    return null;
  }

  const next = normalizeMcpServerUpdateInput(input, existing);
  const createdSecretIds: string[] = [];

  try {
    const nextEnvRefs =
      next.transport === "stdio"
        ? await applySecretMutations({
            userId,
            serverId: existing.id,
            slotPrefix: "env",
            currentRefs: existing.transport === "stdio" ? existing.envRefs : {},
            operations: next.envSecretOps,
            createdSecretIds,
          })
        : {};

    const nextHeaderRefs =
      next.transport === "http"
        ? await applySecretMutations({
            userId,
            serverId: existing.id,
            slotPrefix: "header",
            currentRefs:
              existing.transport === "http" ? existing.headerRefs : {},
            operations: next.headerSecretOps,
            createdSecretIds,
          })
        : {};

    validateNoPlainSecretKeyConflicts(
      next.transport === "stdio" ? next.envPlain : {},
      Object.keys(nextEnvRefs),
      "env"
    );
    validateNoPlainSecretKeyConflicts(
      next.transport === "http" ? next.headerPlain : {},
      Object.keys(nextHeaderRefs),
      "headers"
    );

    const { data, error } = await supabaseAdmin
      .from("user_mcp_servers")
      .update({
        name: next.name,
        enabled: next.enabled,
        transport: next.transport,
        command: next.transport === "stdio" ? next.command : null,
        args: next.transport === "stdio" ? next.args : [],
        env_refs: next.transport === "stdio" ? nextEnvRefs : {},
        env_plain: next.transport === "stdio" ? next.envPlain : {},
        url: next.transport === "http" ? next.url : null,
        header_refs: next.transport === "http" ? nextHeaderRefs : {},
        header_plain: next.transport === "http" ? next.headerPlain : {},
        extra: next.extra,
      })
      .eq("user_id", userId)
      .eq("id", id)
      .select(MCP_SERVER_COLUMNS)
      .single();

    if (error) {
      throw normalizeStorageError(error) ?? new Error(error.message);
    }

    return toWebRecord(normalizeStoredState(asMcpServerRow(data)));
  } catch (err) {
    await Promise.allSettled(
      createdSecretIds.map((secretId) => deleteSecret(secretId))
    );
    throw err;
  }
}

export async function deleteUserMcpServer(userId: string, id: string) {
  const { count, error } = await supabaseAdmin
    .from("user_mcp_servers")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("id", id);

  if (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw normalizeStorageError(error) ?? new Error(error.message);
  }

  return (count ?? 0) > 0;
}

export async function countVaultSecretsForUserMcpServers(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_mcp_servers")
    .select("env_refs, header_refs")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to load MCP secret refs: ${error.message}`);
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{
    env_refs: unknown;
    header_refs: unknown;
  }>) {
    for (const secretId of Object.values(
      normalizeStringRecord(row.env_refs, "env_refs")
    )) {
      ids.add(secretId);
    }
    for (const secretId of Object.values(
      normalizeStringRecord(row.header_refs, "header_refs")
    )) {
      ids.add(secretId);
    }
  }

  if (ids.size === 0) {
    return 0;
  }

  const { count, error: countError } = await supabaseAdmin
    .schema("vault")
    .from("secrets")
    .select("id", { count: "exact", head: true })
    .in("id", [...ids]);

  if (countError) {
    throw new Error(`Failed to count MCP secrets: ${countError.message}`);
  }

  return count ?? 0;
}
