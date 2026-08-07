import type {
  JsonObject,
  StringRecord,
  SecretMutationRecord,
  McpServerCreateInput,
  McpServerStoredState,
  McpServerUpdateInput,
} from "./types";
import { McpServerValidationError } from "./types";
import {
  isObject,
  normalizeName,
  normalizeBoolean,
  normalizeTransport,
  normalizeStringArray,
  normalizeStringRecord,
  normalizeExtra,
  validateNoPlainSecretKeyConflicts,
} from "./validation";

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

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

export function normalizeMcpServerUpdateInput(
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
