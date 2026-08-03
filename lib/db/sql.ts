// SQL-building primitives shared by the PostgREST shim: identifier quoting,
// JSON-path compilation, the parameter collector, filter compilation, and the
// parsers for PostgREST's select-embed and or() string syntaxes.

export type Queryable = {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

export function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][\w$]*$/.test(name)) {
    throw new Error(
      `postgrest-shim: unsafe identifier ${JSON.stringify(name)}`
    );
  }
  return `"${name}"`;
}

// Compiles a PostgREST column path — plain column or JSON arrows like
// `metadata->>agent_id` — into a SQL expression rooted at `qualifier`.
export function compileColumnPath(path: string, qualifier: string): string {
  const arrowSplit = path.split(/(->>|->)/);
  const base = arrowSplit[0].trim();
  let sql = `${qualifier}.${quoteIdent(base)}`;
  for (let i = 1; i < arrowSplit.length; i += 2) {
    const arrow = arrowSplit[i];
    const key = arrowSplit[i + 1]?.trim();
    if (!key || !/^[\w-]+$/.test(key)) {
      throw new Error(
        `postgrest-shim: unsafe JSON path ${JSON.stringify(path)}`
      );
    }
    sql = `${sql}${arrow}'${key}'`;
  }
  return sql;
}

export function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export class SqlBuilder {
  readonly params: unknown[] = [];

  add(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}

// ---------------------------------------------------------------------------
// Filters

export type Filter = {
  path: string;
  op: string;
  value: unknown;
  negated: boolean;
};

const OP_SQL: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  ilike: "ILIKE",
  ov: "&&",
};

function compileIsCondition(column: string, value: unknown): string {
  if (value === null) return `${column} IS NULL`;
  if (value === true) return `${column} IS TRUE`;
  if (value === false) return `${column} IS FALSE`;
  throw new Error(
    `postgrest-shim: .is() supports null/true/false, got ${String(value)}`
  );
}

export function compileFilter(
  filter: Filter,
  qualifier: string,
  sql: SqlBuilder
): string {
  const column = compileColumnPath(filter.path, qualifier);
  let condition: string;
  switch (filter.op) {
    case "is": {
      condition = compileIsCondition(column, filter.value);

      break;
    }
    case "in": {
      condition = `${column} = ANY(${sql.add(filter.value)})`;

      break;
    }
    case "cs": {
      const value =
        typeof filter.value === "object" && !Array.isArray(filter.value)
          ? `${sql.add(JSON.stringify(filter.value))}::jsonb`
          : sql.add(filter.value);
      condition = `${column} @> ${value}`;

      break;
    }
    case "isdistinct": {
      const value = filter.value === null ? "NULL" : sql.add(filter.value);
      condition = `${column} IS DISTINCT FROM ${value}`;

      break;
    }
    default: {
      const operator = OP_SQL[filter.op];
      if (!operator) {
        throw new Error(`postgrest-shim: unsupported operator ${filter.op}`);
      }
      condition = `${column} ${operator} ${sql.add(filter.value)}`;
    }
  }
  return filter.negated ? `NOT (${condition})` : condition;
}

const OR_PART_PATTERN = /^([^.]+(?:->>?[^.]+)*)\.(not\.)?([a-z]+)\.(.*)$/;

const IS_VALUES: Record<string, unknown> = {
  null: null,
  true: true,
  false: false,
};

// Parses PostgREST's or() condition string: `a.is.null,b.neq.stopped,c.gt.5`.
export function parseOrString(conditions: string): Filter[] {
  return splitTopLevel(conditions).map((part) => {
    const match = part.match(OR_PART_PATTERN);
    if (!match) {
      throw new Error(
        `postgrest-shim: cannot parse or() part ${JSON.stringify(part)}`
      );
    }
    const [, path, notPrefix, op, rawValue] = match;
    const value =
      (op === "is" || op === "isdistinct") && rawValue in IS_VALUES
        ? IS_VALUES[rawValue]
        : rawValue;
    return { path, op, value, negated: Boolean(notPrefix) };
  });
}

// ---------------------------------------------------------------------------
// Select-string parsing (embedded resources)

export type ParsedSelect = {
  fields: string[];
  embeds: ParsedEmbed[];
};

export type ParsedEmbed = {
  alias: string;
  table: string;
  inner: boolean;
  // Explicit FK constraint name (`table!my_fkey(...)`), used to pick the
  // relationship when more than one FK links the two tables (e.g. cycles).
  fkHint: string | null;
  select: ParsedSelect;
};

export function parseSelect(select: string): ParsedSelect {
  const fields: string[] = [];
  const embeds: ParsedEmbed[] = [];
  for (const part of splitTopLevel(select)) {
    const parenIndex = part.indexOf("(");
    if (parenIndex === -1) {
      fields.push(part);
      continue;
    }
    if (!part.endsWith(")")) {
      throw new Error(
        `postgrest-shim: malformed embed ${JSON.stringify(part)}`
      );
    }
    const head = part.slice(0, parenIndex).trim();
    // PostgREST embed head grammar: `alias:table!hint1!hint2` where a hint is
    // `inner`, `left`, or an FK constraint name.
    const [namePart, ...hints] = head.split("!").map((s) => s.trim());
    let inner = false;
    let fkHint: string | null = null;
    for (const hint of hints) {
      if (hint === "inner") inner = true;
      else if (hint === "left") continue;
      else fkHint = hint;
    }
    const [aliasOrTable, tableIfAliased] = namePart
      .split(":")
      .map((s) => s.trim());
    const table = tableIfAliased ?? aliasOrTable;
    const alias = tableIfAliased ? aliasOrTable : table;
    embeds.push({
      alias,
      table,
      inner,
      fkHint,
      select: parseSelect(part.slice(parenIndex + 1, -1)),
    });
  }
  return { fields, embeds };
}
