import { supabaseAdmin } from "@/lib/supabase/admin";

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

const RESERVED_STDIO_EXTRA_KEYS = new Set([
  "args",
  "command",
  "env",
  "http_headers",
  "url",
]);

const RESERVED_HTTP_EXTRA_KEYS = new Set([
  "args",
  "command",
  "env",
  "http_headers",
  "url",
]);

type JsonObject = Record<string, unknown>;
type StringRecord = Record<string, string>;
type SecretMutationRecord = Record<string, string | null>;

type McpServerRow = {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: unknown;
  env_refs: unknown;
  env_plain: unknown;
  url: string | null;
  header_refs: unknown;
  header_plain: unknown;
  extra: unknown;
  created_at: string;
  updated_at: string;
};

export type McpServerWebRecord = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envPlain: StringRecord;
  envSecretNames: string[];
  url: string | null;
  headerPlain: StringRecord;
  headerSecretNames: string[];
  extra: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type McpServerCliRecord = {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

export type McpServerCreateInput =
  | {
      name: string;
      enabled: boolean;
      transport: "stdio";
      command: string;
      args: string[];
      envPlain: StringRecord;
      envSecrets: StringRecord;
      url: null;
      headerPlain: StringRecord;
      headerSecrets: StringRecord;
      extra: JsonObject;
    }
  | {
      name: string;
      enabled: boolean;
      transport: "http";
      command: null;
      args: string[];
      envPlain: StringRecord;
      envSecrets: StringRecord;
      url: string;
      headerPlain: StringRecord;
      headerSecrets: StringRecord;
      extra: JsonObject;
    };

type McpServerStoredState = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envRefs: StringRecord;
  envPlain: StringRecord;
  url: string | null;
  headerRefs: StringRecord;
  headerPlain: StringRecord;
  extra: JsonObject;
  createdAt: string;
  updatedAt: string;
};

type McpServerUpdateInput =
  | {
      name: string;
      enabled: boolean;
      transport: "stdio";
      command: string;
      args: string[];
      envPlain: StringRecord;
      envSecretOps: SecretMutationRecord;
      url: null;
      headerPlain: StringRecord;
      headerSecretOps: SecretMutationRecord;
      extra: JsonObject;
    }
  | {
      name: string;
      enabled: boolean;
      transport: "http";
      command: null;
      args: string[];
      envPlain: StringRecord;
      envSecretOps: SecretMutationRecord;
      url: string;
      headerPlain: StringRecord;
      headerSecretOps: SecretMutationRecord;
      extra: JsonObject;
    };

type VaultSecretRow = {
  id: string;
  decrypted_secret: string;
};

type SupabaseLikeError = {
  code?: string;
  message: string;
};

export class McpServerValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "INVALID_MCP_SERVER", status = 400) {
    super(message);
    this.name = "McpServerValidationError";
    this.status = status;
    this.code = code;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMcpServerRow(value: unknown) {
  return value as McpServerRow;
}

function asMcpServerRows(value: unknown) {
  return (value as McpServerRow[]) ?? [];
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeName(value: unknown) {
  const name = asTrimmedString(value);
  if (!name) {
    throw new McpServerValidationError("name is required");
  }
  if (name.includes("__")) {
    throw new McpServerValidationError(
      'name must not contain "__"',
      "INVALID_NAME"
    );
  }
  return name;
}

function normalizeBoolean(value: unknown, fallback = true) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new McpServerValidationError("enabled must be a boolean");
  }
  return value;
}

function normalizeTransport(value: unknown) {
  if (value !== "stdio" && value !== "http") {
    throw new McpServerValidationError(
      "transport must be stdio or http",
      "INVALID_TRANSPORT"
    );
  }
  return value;
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new McpServerValidationError(`${fieldName} must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new McpServerValidationError(
        `${fieldName}[${index}] must be a string`
      );
    }
    return entry;
  });
}

function normalizeStringRecord(
  value: unknown,
  fieldName: string
): StringRecord {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new McpServerValidationError(`${fieldName} must be an object`);
  }

  const record: StringRecord = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new McpServerValidationError(`${fieldName} contains an empty key`);
    }
    if (typeof raw !== "string") {
      throw new McpServerValidationError(
        `${fieldName}.${normalizedKey} must be a string`
      );
    }
    record[normalizedKey] = raw;
  }

  return record;
}

function normalizeSecretCreateRecord(
  value: unknown,
  fieldName: string
): StringRecord {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new McpServerValidationError(`${fieldName} must be an object`);
  }

  const record: StringRecord = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new McpServerValidationError(`${fieldName} contains an empty key`);
    }
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new McpServerValidationError(
        `${fieldName}.${normalizedKey} must be a non-empty string`
      );
    }
    record[normalizedKey] = raw;
  }

  return record;
}

function normalizeSecretMutationRecord(
  value: unknown,
  fieldName: string
): SecretMutationRecord {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new McpServerValidationError(`${fieldName} must be an object`);
  }

  const record: SecretMutationRecord = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new McpServerValidationError(`${fieldName} contains an empty key`);
    }
    if (raw === null) {
      record[normalizedKey] = null;
      continue;
    }
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new McpServerValidationError(
        `${fieldName}.${normalizedKey} must be a non-empty string or null`
      );
    }
    record[normalizedKey] = raw;
  }

  return record;
}

function normalizeExtra(value: unknown): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new McpServerValidationError("extra must be an object");
  }
  return value;
}

function validateExtraKeys(extra: JsonObject, transport: "stdio" | "http") {
  const reservedKeys =
    transport === "stdio"
      ? RESERVED_STDIO_EXTRA_KEYS
      : RESERVED_HTTP_EXTRA_KEYS;

  for (const key of Object.keys(extra)) {
    if (reservedKeys.has(key)) {
      throw new McpServerValidationError(
        `extra.${key} is reserved for ${transport} servers`,
        "INVALID_EXTRA"
      );
    }
  }
}

function validateNoPlainSecretKeyConflicts(
  plain: StringRecord,
  secretKeys: Iterable<string>,
  fieldName: string
) {
  const plainKeys = new Set(Object.keys(plain));
  for (const secretKey of secretKeys) {
    if (plainKeys.has(secretKey)) {
      throw new McpServerValidationError(
        `${fieldName} cannot contain the same key in both plain and secret maps`,
        "INVALID_DUPLICATE_KEY"
      );
    }
  }
}

function normalizeOptionalCommand(value: unknown) {
  const command = asTrimmedString(value);
  if (!command) {
    throw new McpServerValidationError("command is required for stdio servers");
  }
  return command;
}

function normalizeOptionalUrl(value: unknown) {
  const url = asTrimmedString(value);
  if (!url) {
    throw new McpServerValidationError("url is required for http servers");
  }
  return url;
}

function normalizeStoredState(row: McpServerRow): McpServerStoredState {
  return {
    id: row.id,
    name: normalizeName(row.name),
    enabled: normalizeBoolean(row.enabled),
    transport: normalizeTransport(row.transport),
    command: row.command,
    args: normalizeStringArray(row.args, "args"),
    envRefs: normalizeStringRecord(row.env_refs, "env_refs"),
    envPlain: normalizeStringRecord(row.env_plain, "env_plain"),
    url: row.url,
    headerRefs: normalizeStringRecord(row.header_refs, "header_refs"),
    headerPlain: normalizeStringRecord(row.header_plain, "header_plain"),
    extra: normalizeExtra(row.extra),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeMcpServerCreateInput(
  input: unknown
): McpServerCreateInput {
  if (!isObject(input)) {
    throw new McpServerValidationError("request body must be an object");
  }

  const name = normalizeName(input.name);
  const enabled = normalizeBoolean(input.enabled, true);
  const transport = normalizeTransport(input.transport);
  const args = normalizeStringArray(input.args, "args");
  const envPlain = normalizeStringRecord(input.envPlain, "envPlain");
  const envSecrets = normalizeSecretCreateRecord(
    input.envSecrets,
    "envSecrets"
  );
  const headerPlain = normalizeStringRecord(input.headerPlain, "headerPlain");
  const headerSecrets = normalizeSecretCreateRecord(
    input.headerSecrets,
    "headerSecrets"
  );
  const extra = normalizeExtra(input.extra);
  validateExtraKeys(extra, transport);
  validateNoPlainSecretKeyConflicts(envPlain, Object.keys(envSecrets), "env");
  validateNoPlainSecretKeyConflicts(
    headerPlain,
    Object.keys(headerSecrets),
    "headers"
  );

  if (transport === "stdio") {
    if (asTrimmedString(input.url)) {
      throw new McpServerValidationError(
        "stdio servers cannot include url",
        "INVALID_TRANSPORT_FIELDS"
      );
    }

    return {
      name,
      enabled,
      transport,
      command: normalizeOptionalCommand(input.command),
      args,
      envPlain,
      envSecrets,
      url: null,
      headerPlain,
      headerSecrets,
      extra,
    };
  }

  if (asTrimmedString(input.command)) {
    throw new McpServerValidationError(
      "http servers cannot include command",
      "INVALID_TRANSPORT_FIELDS"
    );
  }

  return {
    name,
    enabled,
    transport,
    command: null,
    args,
    envPlain,
    envSecrets,
    url: normalizeOptionalUrl(input.url),
    headerPlain,
    headerSecrets,
    extra,
  };
}

function normalizeMcpServerUpdateInput(
  input: unknown,
  existing: McpServerStoredState
): McpServerUpdateInput {
  if (!isObject(input)) {
    throw new McpServerValidationError("request body must be an object");
  }

  const nextTransport =
    input.transport === undefined
      ? existing.transport
      : normalizeTransport(input.transport);
  const name =
    input.name === undefined ? existing.name : normalizeName(input.name);
  const enabled =
    input.enabled === undefined
      ? existing.enabled
      : normalizeBoolean(input.enabled, existing.enabled);
  const args =
    input.args === undefined
      ? nextTransport === "stdio"
        ? existing.args
        : []
      : normalizeStringArray(input.args, "args");
  const extra =
    input.extra === undefined ? existing.extra : normalizeExtra(input.extra);
  validateExtraKeys(extra, nextTransport);

  if (nextTransport === "stdio") {
    if (input.url !== undefined && asTrimmedString(input.url)) {
      throw new McpServerValidationError(
        "stdio servers cannot include url",
        "INVALID_TRANSPORT_FIELDS"
      );
    }

    const command =
      input.command === undefined
        ? existing.transport === "stdio"
          ? existing.command
          : null
        : normalizeOptionalCommand(input.command);

    if (!command) {
      throw new McpServerValidationError(
        "command is required for stdio servers"
      );
    }

    return {
      name,
      enabled,
      transport: nextTransport,
      command,
      args,
      envPlain:
        input.envPlain === undefined
          ? existing.transport === "stdio"
            ? existing.envPlain
            : {}
          : normalizeStringRecord(input.envPlain, "envPlain"),
      envSecretOps: normalizeSecretMutationRecord(
        input.envSecrets,
        "envSecrets"
      ),
      url: null,
      headerPlain:
        input.headerPlain === undefined
          ? existing.transport === "http"
            ? existing.headerPlain
            : {}
          : normalizeStringRecord(input.headerPlain, "headerPlain"),
      headerSecretOps: normalizeSecretMutationRecord(
        input.headerSecrets,
        "headerSecrets"
      ),
      extra,
    };
  }

  if (input.command !== undefined && asTrimmedString(input.command)) {
    throw new McpServerValidationError(
      "http servers cannot include command",
      "INVALID_TRANSPORT_FIELDS"
    );
  }

  const url =
    input.url === undefined
      ? existing.transport === "http"
        ? existing.url
        : null
      : normalizeOptionalUrl(input.url);

  if (!url) {
    throw new McpServerValidationError("url is required for http servers");
  }

  return {
    name,
    enabled,
    transport: nextTransport,
    command: null,
    args,
    envPlain:
      input.envPlain === undefined
        ? existing.transport === "stdio"
          ? existing.envPlain
          : {}
        : normalizeStringRecord(input.envPlain, "envPlain"),
    envSecretOps: normalizeSecretMutationRecord(input.envSecrets, "envSecrets"),
    url,
    headerPlain:
      input.headerPlain === undefined
        ? existing.transport === "http"
          ? existing.headerPlain
          : {}
        : normalizeStringRecord(input.headerPlain, "headerPlain"),
    headerSecretOps: normalizeSecretMutationRecord(
      input.headerSecrets,
      "headerSecrets"
    ),
    extra,
  };
}

function toWebRecord(row: McpServerStoredState): McpServerWebRecord {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    transport: row.transport,
    command: row.command,
    args: row.args,
    envPlain: row.envPlain,
    envSecretNames: Object.keys(row.envRefs).sort(),
    url: row.url,
    headerPlain: row.headerPlain,
    headerSecretNames: Object.keys(row.headerRefs).sort(),
    extra: row.extra,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function uniqueSecretIds(rows: McpServerStoredState[]) {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const secretId of Object.values(row.envRefs)) {
      ids.add(secretId);
    }
    for (const secretId of Object.values(row.headerRefs)) {
      ids.add(secretId);
    }
  }
  return [...ids];
}

async function resolveVaultSecrets(
  secretIds: string[]
): Promise<Map<string, string>> {
  if (secretIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .schema("vault")
    .from("decrypted_secrets")
    .select("id, decrypted_secret")
    .in("id", secretIds);

  if (error) {
    throw new Error(`Failed to resolve MCP secrets: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as VaultSecretRow[]).map((row) => [
      row.id,
      row.decrypted_secret,
    ])
  );
}

function toCliRecord(
  row: McpServerStoredState,
  resolvedSecrets: Map<string, string>
): McpServerCliRecord {
  if (row.transport === "stdio") {
    const env: StringRecord = { ...row.envPlain };
    for (const [name, secretId] of Object.entries(row.envRefs)) {
      const value = resolvedSecrets.get(secretId);
      if (value !== undefined) {
        env[name] = value;
      }
    }

    return {
      name: row.name,
      enabled: row.enabled,
      config: {
        ...row.extra,
        command: row.command,
        args: row.args,
        env,
      },
    };
  }

  const httpHeaders: StringRecord = { ...row.headerPlain };
  for (const [name, secretId] of Object.entries(row.headerRefs)) {
    const value = resolvedSecrets.get(secretId);
    if (value !== undefined) {
      httpHeaders[name] = value;
    }
  }

  return {
    name: row.name,
    enabled: row.enabled,
    config: {
      ...row.extra,
      url: row.url,
      http_headers: httpHeaders,
    },
  };
}

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

async function createSecret(
  userId: string,
  serverId: string,
  slot: string,
  value: string
) {
  const { data, error } = await supabaseAdmin.rpc(
    "create_user_mcp_server_secret",
    {
      p_user_id: userId,
      p_server_id: serverId,
      p_slot: slot,
      p_secret: value,
    }
  );

  if (error) {
    throw new Error(`Failed to create MCP secret: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error("Failed to create MCP secret: missing secret id");
  }

  return data;
}

async function updateSecret(
  secretId: string,
  userId: string,
  serverId: string,
  slot: string,
  value: string
) {
  const { error } = await supabaseAdmin.rpc("update_user_mcp_server_secret", {
    p_secret_id: secretId,
    p_user_id: userId,
    p_server_id: serverId,
    p_slot: slot,
    p_secret: value,
  });

  if (error) {
    throw new Error(`Failed to update MCP secret: ${error.message}`);
  }
}

async function deleteSecret(secretId: string) {
  const { error } = await supabaseAdmin.rpc("delete_user_mcp_server_secret", {
    p_secret_id: secretId,
  });

  if (error) {
    throw new Error(`Failed to delete MCP secret: ${error.message}`);
  }
}

async function applySecretMutations(input: {
  userId: string;
  serverId: string;
  slotPrefix: "env" | "header";
  currentRefs: StringRecord;
  operations: SecretMutationRecord;
  createdSecretIds: string[];
}) {
  const nextRefs: StringRecord = { ...input.currentRefs };

  for (const [key, value] of Object.entries(input.operations)) {
    const slot = `${input.slotPrefix}/${key}`;
    if (value === null) {
      delete nextRefs[key];
      continue;
    }

    const existingSecretId = nextRefs[key];
    if (existingSecretId) {
      await updateSecret(
        existingSecretId,
        input.userId,
        input.serverId,
        slot,
        value
      );
      continue;
    }

    const secretId = await createSecret(
      input.userId,
      input.serverId,
      slot,
      value
    );
    input.createdSecretIds.push(secretId);
    nextRefs[key] = secretId;
  }

  return nextRefs;
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
  } catch (error) {
    await Promise.allSettled(
      createdSecretIds.map((secretId) => deleteSecret(secretId))
    );
    await supabaseAdmin
      .from("user_mcp_servers")
      .delete()
      .eq("user_id", userId)
      .eq("id", createdRow.id);
    throw error;
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
  } catch (error) {
    await Promise.allSettled(
      createdSecretIds.map((secretId) => deleteSecret(secretId))
    );
    throw error;
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
