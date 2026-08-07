import type {
  JsonObject,
  StringRecord,
  McpServerRow,
  McpServerStoredState,
  McpServerWebRecord,
  McpServerCliRecord,
} from "./types";
import { McpServerValidationError } from "./types";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asMcpServerRow(value: unknown) {
  return value as McpServerRow;
}

export function asMcpServerRows(value: unknown) {
  return (value as McpServerRow[]) ?? [];
}

export function normalizeName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
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

export function normalizeBoolean(value: unknown, fallback = true) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new McpServerValidationError("enabled must be a boolean");
  }
  return value;
}

export function normalizeTransport(value: unknown) {
  if (value !== "stdio" && value !== "http") {
    throw new McpServerValidationError(
      "transport must be stdio or http",
      "INVALID_TRANSPORT"
    );
  }
  return value;
}

export function normalizeStringArray(
  value: unknown,
  fieldName: string
): string[] {
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

export function normalizeStringRecord(
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

export function normalizeExtra(value: unknown): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new McpServerValidationError("extra must be an object");
  }
  return value;
}

export function validateNoPlainSecretKeyConflicts(
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

export function normalizeStoredState(row: McpServerRow): McpServerStoredState {
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

export function toWebRecord(row: McpServerStoredState): McpServerWebRecord {
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

export function toCliRecord(
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
