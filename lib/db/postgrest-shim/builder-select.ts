// SELECT execution helpers for the PostgREST shim builder.

import { SchemaCache } from "../schema-cache";
import {
  compileColumnPath,
  compileFilter,
  parseSelect,
  quoteIdent,
  SqlBuilder,
  type Filter,
  type ParsedEmbed,
  type ParsedSelect,
  type Queryable,
} from "../sql";
import type { ShimResult } from "./types";
import { noRowsError } from "./types";

type Order = { path: string; ascending: boolean; nullsFirst?: boolean };

export type SelectBuilderState = {
  table: string;
  select: string | null;
  countMode: "exact" | null;
  head: boolean;
  filters: Filter[];
  orFilters: Filter[][];
  orders: Order[];
  limit: number | null;
  offset: number | null;
  single: boolean;
  maybeSingle: boolean;
};

export function splitEmbedFilters(
  filters: Filter[],
  parsed: ParsedSelect
): {
  tableFilters: Filter[];
  embedFilters: Map<string, Filter[]>;
} {
  const embedNames = new Set(parsed.embeds.map((embed) => embed.alias));
  const tableFilters: Filter[] = [];
  const embedFilters = new Map<string, Filter[]>();
  for (const filter of filters) {
    const dotIndex = filter.path.indexOf(".");
    const arrowIndex = filter.path.search(/->/);
    const prefix =
      dotIndex > 0 && (arrowIndex === -1 || dotIndex < arrowIndex)
        ? filter.path.slice(0, dotIndex)
        : null;
    if (prefix && embedNames.has(prefix)) {
      const scoped = embedFilters.get(prefix) ?? [];
      scoped.push({ ...filter, path: filter.path.slice(dotIndex + 1) });
      embedFilters.set(prefix, scoped);
    } else {
      tableFilters.push(filter);
    }
  }
  return { tableFilters, embedFilters };
}

export async function buildEmbedSubquery(
  parentTable: string,
  parentQualifier: string,
  embed: ParsedEmbed,
  filters: Filter[],
  sql: SqlBuilder,
  schema: SchemaCache
): Promise<string> {
  const relationship = await schema.getRelationship(
    parentTable,
    embed.table,
    embed.fkHint
  );
  const childQualifier = quoteIdent(`__embed_${embed.alias}`);
  const childSelectList = await buildSelectList(
    embed.table,
    childQualifier,
    embed.select,
    new Map(),
    sql,
    schema
  );
  // Relationship cols are normalized so the join is always
  // child.childCols[i] = parent.parentCols[i], regardless of FK direction.
  const joinConditions = relationship.parentCols
    .map(
      (parentCol, i) =>
        `${childQualifier}.${quoteIdent(
          relationship.childCols[i]
        )} = ${parentQualifier}.${quoteIdent(parentCol)}`
    )
    .join(" AND ");
  const filterConditions = filters
    .map((filter) => compileFilter(filter, childQualifier, sql))
    .join(" AND ");
  const where = [joinConditions, filterConditions]
    .filter(Boolean)
    .join(" AND ");
  const inner = `select ${childSelectList} from ${quoteIdent(
    embed.table
  )} as ${childQualifier} where ${where}`;

  if (relationship.kind === "many-to-one") {
    return `(select row_to_json(sub) from (${inner}) sub) as ${quoteIdent(embed.alias)}`;
  }
  return `coalesce((select json_agg(sub) from (${inner}) sub), '[]'::json) as ${quoteIdent(embed.alias)}`;
}

export async function buildSelectList(
  table: string,
  qualifier: string,
  parsed: ParsedSelect,
  embedFilters: Map<string, Filter[]>,
  sql: SqlBuilder,
  schema: SchemaCache
): Promise<string> {
  const parts: string[] = [];
  for (const field of parsed.fields) {
    parts.push(
      field === "*" ? `${qualifier}.*` : compileColumnPath(field, qualifier)
    );
  }
  for (const embed of parsed.embeds) {
    parts.push(
      await buildEmbedSubquery(
        table,
        qualifier,
        embed,
        embedFilters.get(embed.alias) ?? [],
        sql,
        schema
      )
    );
  }
  if (parts.length === 0) parts.push(`${qualifier}.*`);
  return parts.join(", ");
}

export async function buildWhere(
  table: string,
  qualifier: string,
  tableFilters: Filter[],
  orFilters: Filter[][],
  parsed: ParsedSelect | null,
  embedFilters: Map<string, Filter[]>,
  sql: SqlBuilder,
  schema: SchemaCache
): Promise<string> {
  const conditions: string[] = tableFilters.map((filter) =>
    compileFilter(filter, qualifier, sql)
  );
  for (const group of orFilters) {
    const parts = group.map((filter) => compileFilter(filter, qualifier, sql));
    conditions.push(`(${parts.join(" OR ")})`);
  }
  // !inner embeds constrain parent rows to those with a matching embed row.
  // Filters on non-inner embeds only filter the embed's own content, which
  // buildEmbedSubquery already handles.
  for (const embed of parsed?.embeds ?? []) {
    if (!embed.inner) continue;
    const scoped = embedFilters.get(embed.alias) ?? [];
    const relationship = await schema.getRelationship(
      table,
      embed.table,
      embed.fkHint
    );
    const existsQualifier = quoteIdent(`__exists_${embed.alias}`);
    const joinConditions = relationship.parentCols
      .map(
        (parentCol, i) =>
          `${existsQualifier}.${quoteIdent(
            relationship.childCols[i]
          )} = ${qualifier}.${quoteIdent(parentCol)}`
      )
      .join(" AND ");
    const filterConditions = scoped
      .map((filter) => compileFilter(filter, existsQualifier, sql))
      .join(" AND ");
    const where = [joinConditions, filterConditions]
      .filter(Boolean)
      .join(" AND ");
    conditions.push(
      `exists (select 1 from ${quoteIdent(embed.table)} as ${existsQualifier} where ${where})`
    );
  }
  return conditions.length > 0 ? ` where ${conditions.join(" AND ")}` : "";
}

export function buildOrderLimit(
  orders: Order[],
  limit: number | null,
  offset: number | null,
  qualifier: string
): string {
  let sql = "";
  if (orders.length > 0) {
    const parts = orders.map((order) => {
      const direction = order.ascending ? "asc" : "desc";
      const nulls =
        order.nullsFirst === undefined
          ? ""
          : order.nullsFirst
            ? " nulls first"
            : " nulls last";
      return `${compileColumnPath(order.path, qualifier)} ${direction}${nulls}`;
    });
    sql += ` order by ${parts.join(", ")}`;
  }
  if (limit !== null) sql += ` limit ${Math.floor(limit)}`;
  if (offset !== null) sql += ` offset ${Math.floor(offset)}`;
  return sql;
}

export async function executeSelect(
  state: SelectBuilderState,
  db: Queryable,
  schema: SchemaCache
): Promise<ShimResult> {
  const parsed = parseSelect(state.select ?? "*");
  const qualifier = quoteIdent(state.table);
  const { tableFilters, embedFilters } = splitEmbedFilters(
    state.filters,
    parsed
  );

  let count: number | null = null;
  if (state.countMode === "exact") {
    const countSql = new SqlBuilder();
    const where = await buildWhere(
      state.table,
      qualifier,
      tableFilters,
      state.orFilters,
      parsed,
      embedFilters,
      countSql,
      schema
    );
    const { rows } = await db.query(
      `select count(*)::int as count from ${qualifier}${where}`,
      countSql.params
    );
    count = Number(rows[0]?.count ?? 0);
  }

  if (state.head) {
    return {
      data: null,
      error: null,
      count,
      status: 200,
      statusText: "OK",
    };
  }

  const sql = new SqlBuilder();
  const selectList = await buildSelectList(
    state.table,
    qualifier,
    parsed,
    embedFilters,
    sql,
    schema
  );
  const where = await buildWhere(
    state.table,
    qualifier,
    tableFilters,
    state.orFilters,
    parsed,
    embedFilters,
    sql,
    schema
  );
  const { rows } = await db.query(
    `select ${selectList} from ${qualifier}${where}${buildOrderLimit(state.orders, state.limit, state.offset, qualifier)}`,
    sql.params
  );
  return shapeRows(rows, count, 200, state.single, state.maybeSingle);
}

export function shapeRows(
  rows: Record<string, unknown>[],
  count: number | null,
  status: number,
  single: boolean,
  maybeSingle: boolean
): ShimResult {
  if (single || maybeSingle) {
    if (rows.length > 1 || (single && rows.length === 0)) {
      return {
        data: null,
        error: noRowsError(rows.length),
        count,
        status: 406,
        statusText: "Not Acceptable",
      };
    }
    return {
      data: rows[0] ?? null,
      error: null,
      count,
      status,
      statusText: "OK",
    };
  }
  return { data: rows, error: null, count, status, statusText: "OK" };
}
