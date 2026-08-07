// WRITE execution helpers for the PostgREST shim builder.

import { SchemaCache } from "../schema-cache";
import {
  compileColumnPath,
  parseSelect,
  quoteIdent,
  SqlBuilder,
  type Filter,
  type Queryable,
} from "../sql";
import type { ShimResult } from "./types";
import { buildWhere, shapeRows } from "./builder-select";

export type WriteBuilderState = {
  table: string;
  // The builder also has "select" but these functions are only called
  // after the caller has verified it's a write operation.
  op: "select" | "insert" | "update" | "delete" | "upsert";
  select: string | null;
  rows: Record<string, unknown>[];
  updateValues: Record<string, unknown> | null;
  onConflict: string | null;
  ignoreDuplicates: boolean;
  filters: Filter[];
  orFilters: Filter[][];
  single: boolean;
  maybeSingle: boolean;
};

export async function castValue(
  table: string,
  column: string,
  value: unknown,
  sql: SqlBuilder,
  schema: SchemaCache
): Promise<string> {
  const types = await schema.getColumnTypes(table);
  const udt = types.get(column);
  if (udt === undefined) {
    throw new Error(`postgrest-shim: unknown column ${table}.${column}`);
  }
  if (value === null || value === undefined) return sql.add(null);
  if (udt === "json" || udt === "jsonb") {
    return `${sql.add(JSON.stringify(value))}::${udt}`;
  }
  return sql.add(value);
}

export async function executeInsert(
  state: WriteBuilderState,
  db: Queryable,
  schema: SchemaCache,
  upsert: boolean
): Promise<ShimResult> {
  if (state.rows.length === 0) {
    return {
      data: state.select === null ? null : [],
      error: null,
      count: null,
      status: 201,
      statusText: "Created",
    };
  }
  const columns = [...new Set(state.rows.flatMap((row) => Object.keys(row)))];
  const sql = new SqlBuilder();
  const valueRows: string[] = [];
  for (const row of state.rows) {
    const values: string[] = [];
    for (const column of columns) {
      values.push(
        await castValue(state.table, column, row[column], sql, schema)
      );
    }
    valueRows.push(`(${values.join(", ")})`);
  }
  let statement = `insert into ${quoteIdent(state.table)} (${columns
    .map(quoteIdent)
    .join(", ")}) values ${valueRows.join(", ")}`;
  if (upsert) {
    const conflictCols = (
      state.onConflict ?? (await schema.getPrimaryKey(state.table)).join(",")
    )
      .split(",")
      .map((col) => col.trim());
    if (state.ignoreDuplicates) {
      statement += ` on conflict (${conflictCols.map(quoteIdent).join(", ")}) do nothing`;
    } else {
      const updatable = columns.filter((col) => !conflictCols.includes(col));
      statement +=
        updatable.length > 0
          ? ` on conflict (${conflictCols.map(quoteIdent).join(", ")}) do update set ${updatable
              .map((col) => `${quoteIdent(col)} = excluded.${quoteIdent(col)}`)
              .join(", ")}`
          : ` on conflict (${conflictCols.map(quoteIdent).join(", ")}) do nothing`;
    }
  }
  return executeWrite(state, statement, sql, 201, db);
}

export async function executeUpdate(
  state: WriteBuilderState,
  db: Queryable,
  schema: SchemaCache
): Promise<ShimResult> {
  const values = state.updateValues ?? {};
  const sql = new SqlBuilder();
  const assignments: string[] = [];
  for (const [column, value] of Object.entries(values)) {
    assignments.push(
      `${quoteIdent(column)} = ${await castValue(state.table, column, value, sql, schema)}`
    );
  }
  const qualifier = quoteIdent(state.table);
  const where = await buildWhere(
    state.table,
    qualifier,
    state.filters,
    state.orFilters,
    null,
    new Map(),
    sql,
    schema
  );
  return executeWrite(
    state,
    `update ${qualifier} set ${assignments.join(", ")}${where}`,
    sql,
    200,
    db
  );
}

export async function executeDelete(
  state: WriteBuilderState,
  db: Queryable,
  schema: SchemaCache
): Promise<ShimResult> {
  const qualifier = quoteIdent(state.table);
  const sql = new SqlBuilder();
  const where = await buildWhere(
    state.table,
    qualifier,
    state.filters,
    state.orFilters,
    null,
    new Map(),
    sql,
    schema
  );
  return executeWrite(state, `delete from ${qualifier}${where}`, sql, 200, db);
}

export async function executeWrite(
  state: WriteBuilderState,
  statement: string,
  sql: SqlBuilder,
  successStatus: number,
  db: Queryable
): Promise<ShimResult> {
  if (state.select !== null) {
    const parsed = parseSelect(state.select || "*");
    if (parsed.embeds.length > 0) {
      throw new Error(
        "postgrest-shim: embedded resources are not supported in write RETURNING"
      );
    }
    const returning = parsed.fields
      .map((field) =>
        field === "*" ? "*" : compileColumnPath(field, quoteIdent(state.table))
      )
      .join(", ");
    const { rows } = await db.query(
      `${statement} returning ${returning}`,
      sql.params
    );
    return shapeRows(
      rows,
      null,
      successStatus,
      state.single,
      state.maybeSingle
    );
  }
  await db.query(statement, sql.params);
  return {
    data: null,
    error: null,
    count: null,
    status: successStatus === 201 ? 201 : 204,
    statusText: successStatus === 201 ? "Created" : "No Content",
  };
}
