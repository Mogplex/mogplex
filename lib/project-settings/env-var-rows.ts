import { parseEnvVarsText, type RepoEnvVars } from "@/lib/repo-settings";

export type EnvVarRow = {
  id: string;
  key: string;
  value: string;
  /** Added because Control asked for this name; skipped on save while empty. */
  requested?: boolean;
};

let nextRowId = 0;

const PROTO_ERROR = "__proto__ can't be used as a variable name.";
const PROTO_LINE = /^\s*__proto__\s*=/m;

/** Stable row id for React keys; never persisted. */
export function createEnvVarRow(key = "", value = ""): EnvVarRow {
  nextRowId += 1;
  return { id: `env-row-${nextRowId}`, key, value };
}

/** Table rows for a repo's stored env vars, sorted by key. */
export function rowsFromEnvVars(vars: RepoEnvVars | null | undefined) {
  return Object.entries(vars ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => createEnvVarRow(key, value));
}

/** Append an empty, requested row for each name the table does not have. */
export function withRequestedNames(
  rows: EnvVarRow[],
  names: readonly string[] = []
) {
  const present = new Set(rows.map((row) => row.key.trim()));
  const added = [...new Set(names)]
    .filter((name) => !present.has(name))
    .map((name) => ({ ...createEnvVarRow(name), requested: true }));
  return added.length > 0 ? [...rows, ...added] : rows;
}

/**
 * Collapse table rows back into the stored map. Blank rows are dropped; a
 * value without a key or a key used twice is an error the user must fix.
 */
export function envVarsFromRows(
  rows: EnvVarRow[]
): { ok: true; vars: RepoEnvVars } | { ok: false; error: string } {
  // A Map, not an object literal, so names like `constructor` are plain keys.
  const vars = new Map<string, string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key && !row.value) continue;
    // A requested name the operator has not filled in yet is not saved empty.
    if (row.requested && !row.value) continue;
    if (!key) return { ok: false, error: "Every value needs a variable name." };
    // The server stores variables on a plain object, where this name is lost.
    if (key === "__proto__") {
      return {
        ok: false,
        error: "__proto__ can't be used as a variable name.",
      };
    }
    if (vars.has(key)) return { ok: false, error: `${key} is defined twice.` };
    vars.set(key, row.value);
  }
  return { ok: true, vars: Object.fromEntries(vars) };
}

/**
 * Merge pasted `.env` text into the table: existing keys take the pasted
 * value, new keys are appended. Throws the parser's error on a bad line.
 */
export function mergePastedEnv(rows: EnvVarRow[], text: string) {
  // The parser stores lines on a plain object, where this name vanishes.
  if (PROTO_LINE.test(text)) throw new Error(PROTO_ERROR);
  const pasted = parseEnvVarsText(text);
  const merged = rows.map((row) => {
    const key = row.key.trim();
    return Object.hasOwn(pasted, key) ? { ...row, value: pasted[key] } : row;
  });
  const existing = new Set(rows.map((row) => row.key.trim()));
  for (const [key, value] of Object.entries(pasted)) {
    if (!existing.has(key)) merged.push(createEnvVarRow(key, value));
  }
  return merged;
}
