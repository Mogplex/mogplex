import type { McpServer, KeyValueEntry, FormState } from "./types";
import { EMPTY_FORM } from "./types";

export function createEntry(partial?: Partial<KeyValueEntry>): KeyValueEntry {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
    isSecret: false,
    saved: false,
    clearRequested: false,
    ...partial,
  };
}

function sortRecordKeys(record: Record<string, string>) {
  return Object.entries(record).sort(([left], [right]) =>
    left.localeCompare(right)
  );
}

export function serverToForm(server: McpServer | null): FormState {
  if (!server) {
    return EMPTY_FORM;
  }

  const envEntries = [
    ...sortRecordKeys(server.envPlain).map(([key, value]) =>
      createEntry({ key, value, isSecret: false })
    ),
    ...[...server.envSecretNames]
      .sort((left, right) => left.localeCompare(right))
      .map((key) =>
        createEntry({
          key,
          isSecret: true,
          saved: true,
          originalKey: key,
        })
      ),
  ];

  const headerEntries = [
    ...sortRecordKeys(server.headerPlain).map(([key, value]) =>
      createEntry({ key, value, isSecret: false })
    ),
    ...[...server.headerSecretNames]
      .sort((left, right) => left.localeCompare(right))
      .map((key) =>
        createEntry({
          key,
          isSecret: true,
          saved: true,
          originalKey: key,
        })
      ),
  ];

  return {
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command ?? "",
    argsText: server.args.join("\n"),
    url: server.url ?? "",
    extraText: JSON.stringify(server.extra ?? {}, null, 2),
    envEntries,
    headerEntries,
  };
}

export function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

export function summarizeServer(server: McpServer) {
  if (server.transport === "stdio") {
    const envCount =
      Object.keys(server.envPlain).length + server.envSecretNames.length;
    return `${server.command ?? "No command"} - ${server.args.length} args - ${envCount} env vars`;
  }

  const headerCount =
    Object.keys(server.headerPlain).length + server.headerSecretNames.length;
  return `${server.url ?? "No URL"} - ${headerCount} headers`;
}

function parseExtra(extraText: string) {
  const trimmed = extraText.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Extra JSON must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Extra JSON must be an object");
  }

  return parsed as Record<string, unknown>;
}

function buildKeyValuePayload(entries: KeyValueEntry[], label: string) {
  const plain: Record<string, string> = {};
  const secrets: Record<string, string | null> = {};
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const key = entry.key.trim();
    const value = entry.value;
    const hasAnyContent =
      key.length > 0 ||
      value.trim().length > 0 ||
      entry.saved ||
      entry.clearRequested;

    if (!hasAnyContent) {
      continue;
    }

    if (!key) {
      throw new Error(`${label} entries need a key`);
    }

    if (entry.isSecret) {
      const originalKey = entry.originalKey?.trim();
      const keyChanged = Boolean(originalKey && originalKey !== key);
      const hasReplacementValue = value.trim().length > 0;

      if (keyChanged && !hasReplacementValue && !entry.clearRequested) {
        throw new Error(
          `Rename the saved ${label.toLowerCase()} secret "${originalKey}" by entering a replacement value or clearing it`
        );
      }

      if (originalKey && (entry.clearRequested || keyChanged)) {
        secrets[originalKey] = null;
      }

      if (hasReplacementValue) {
        if (seenKeys.has(key)) {
          throw new Error(`Duplicate ${label.toLowerCase()} key "${key}"`);
        }
        seenKeys.add(key);
        secrets[key] = value;
        continue;
      }

      if (entry.saved || entry.clearRequested) {
        continue;
      }

      throw new Error(`Secret ${label.toLowerCase()} "${key}" needs a value`);
    }

    if (seenKeys.has(key)) {
      throw new Error(`Duplicate ${label.toLowerCase()} key "${key}"`);
    }
    seenKeys.add(key);

    if (value.length > 0) {
      plain[key] = value;
    }
  }

  return { plain, secrets };
}

export function buildPayload(form: FormState) {
  const extra = parseExtra(form.extraText);
  const env = buildKeyValuePayload(form.envEntries, "Environment");
  const headers = buildKeyValuePayload(form.headerEntries, "Header");
  const base = {
    name: form.name,
    enabled: form.enabled,
    transport: form.transport,
    args: form.argsText
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    envPlain: env.plain,
    envSecrets: env.secrets,
    headerPlain: headers.plain,
    headerSecrets: headers.secrets,
    extra,
  };

  if (form.transport === "stdio") {
    return {
      ...base,
      command: form.command,
      url: undefined,
    };
  }

  return {
    ...base,
    command: undefined,
    url: form.url,
  };
}
