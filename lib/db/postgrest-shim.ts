// pg-backed drop-in for the supabase-js service-role client. Implements the
// PostgREST query-builder surface this codebase actually uses (see the
// operator inventory in the PR that introduced it) directly against Postgres,
// so `supabaseAdmin` call sites keep working unchanged when the data backend
// is Neon. Service-role semantics hold because the Neon role owns the tables
// and table owners bypass RLS.
//
// Deliberately NOT implemented (unused by this app): realtime channels,
// foreignTable order/limit options, textSearch, csv, embedded resources in
// insert/update/delete RETURNING, and auth beyond admin.getUserById. Anything
// unimplemented throws loudly rather than misbehaving quietly.
import { SchemaCache } from "./schema-cache";
import {
  compileColumnPath,
  compileFilter,
  parseOrString,
  parseSelect,
  quoteIdent,
  SqlBuilder,
  type Filter,
  type ParsedEmbed,
  type ParsedSelect,
  type Queryable,
} from "./sql";

export { parseSelect, type Queryable } from "./sql";

export type ShimError = {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
  // pg surfaces the violated constraint's name directly; call sites (e.g.
  // profile slug-collision retry) distinguish unique violations by it.
  constraint?: string;
};

export type ShimResult<T = unknown> = {
  data: T;
  error: ShimError | null;
  count: number | null;
  status: number;
  statusText: string;
};

type PgError = Error & {
  code?: string;
  detail?: string;
  hint?: string;
  constraint?: string;
};

function toShimError(error: unknown): ShimError {
  const pgError = error as PgError;
  return {
    message: pgError.message ?? String(error),
    code: pgError.code ?? "SHIM_ERROR",
    details: pgError.detail ?? null,
    hint: pgError.hint ?? null,
    ...(pgError.constraint ? { constraint: pgError.constraint } : {}),
  };
}

function noRowsError(rowCount: number): ShimError {
  // PostgREST's code for "requested a single JSON object, got N != 1 rows" —
  // call sites check for it explicitly.
  return {
    message: `JSON object requested, multiple (or no) rows returned`,
    code: "PGRST116",
    details: `The result contains ${rowCount} rows`,
    hint: null,
  };
}

// ---------------------------------------------------------------------------
// Query builder

type Order = { path: string; ascending: boolean; nullsFirst?: boolean };

type BuilderState = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  select: string | null;
  countMode: "exact" | null;
  head: boolean;
  rows: Record<string, unknown>[];
  updateValues: Record<string, unknown> | null;
  onConflict: string | null;
  ignoreDuplicates: boolean;
  filters: Filter[];
  orFilters: Filter[][];
  orders: Order[];
  limit: number | null;
  offset: number | null;
  single: boolean;
  maybeSingle: boolean;
};

type SelectOptions = { count?: "exact"; head?: boolean };

export class PostgrestShimBuilder implements PromiseLike<ShimResult> {
  private readonly state: BuilderState;

  constructor(
    private readonly db: Queryable,
    private readonly schema: SchemaCache,
    table: string
  ) {
    this.state = {
      table,
      op: "select",
      select: null,
      countMode: null,
      head: false,
      rows: [],
      updateValues: null,
      onConflict: null,
      ignoreDuplicates: false,
      filters: [],
      orFilters: [],
      orders: [],
      limit: null,
      offset: null,
      single: false,
      maybeSingle: false,
    };
  }

  select(columns = "*", options: SelectOptions = {}): this {
    // On a write builder this only requests RETURNING.
    this.state.select = columns;
    if (options.count) this.state.countMode = options.count;
    if (options.head) this.state.head = true;
    return this;
  }

  insert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options: { count?: "exact" } = {}
  ): this {
    this.state.op = "insert";
    this.state.rows = Array.isArray(values) ? values : [values];
    this.state.select = null;
    if (options.count) this.state.countMode = options.count;
    return this;
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  ): this {
    this.state.op = "upsert";
    this.state.rows = Array.isArray(values) ? values : [values];
    this.state.onConflict = options.onConflict ?? null;
    this.state.ignoreDuplicates = options.ignoreDuplicates ?? false;
    this.state.select = null;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.state.op = "update";
    this.state.updateValues = values;
    this.state.select = null;
    return this;
  }

  delete(): this {
    this.state.op = "delete";
    this.state.select = null;
    return this;
  }

  eq(path: string, value: unknown): this {
    return this.pushFilter(path, "eq", value);
  }
  neq(path: string, value: unknown): this {
    return this.pushFilter(path, "neq", value);
  }
  gt(path: string, value: unknown): this {
    return this.pushFilter(path, "gt", value);
  }
  gte(path: string, value: unknown): this {
    return this.pushFilter(path, "gte", value);
  }
  lt(path: string, value: unknown): this {
    return this.pushFilter(path, "lt", value);
  }
  lte(path: string, value: unknown): this {
    return this.pushFilter(path, "lte", value);
  }
  like(path: string, value: unknown): this {
    return this.pushFilter(path, "like", value);
  }
  ilike(path: string, value: unknown): this {
    return this.pushFilter(path, "ilike", value);
  }
  is(path: string, value: unknown): this {
    return this.pushFilter(path, "is", value);
  }
  in(path: string, values: readonly unknown[]): this {
    return this.pushFilter(path, "in", [...values]);
  }
  contains(path: string, value: unknown): this {
    return this.pushFilter(path, "cs", value);
  }
  overlaps(path: string, value: unknown): this {
    return this.pushFilter(path, "ov", value);
  }
  not(path: string, op: string, value: unknown): this {
    this.state.filters.push({
      path,
      op,
      value: op === "is" && value === null ? null : value,
      negated: true,
    });
    return this;
  }
  filter(path: string, op: string, value: unknown): this {
    const negated = op.startsWith("not.");
    return this.pushFilter(path, negated ? op.slice(4) : op, value, negated);
  }
  match(values: Record<string, unknown>): this {
    for (const [path, value] of Object.entries(values)) {
      this.pushFilter(path, "eq", value);
    }
    return this;
  }
  or(conditions: string): this {
    this.state.orFilters.push(parseOrString(conditions));
    return this;
  }

  order(
    path: string,
    options: { ascending?: boolean; nullsFirst?: boolean } = {}
  ): this {
    this.state.orders.push({
      path,
      ascending: options.ascending ?? true,
      nullsFirst: options.nullsFirst,
    });
    return this;
  }

  limit(count: number): this {
    this.state.limit = count;
    return this;
  }

  range(from: number, to: number): this {
    this.state.offset = from;
    this.state.limit = to - from + 1;
    return this;
  }

  single(): this {
    this.state.single = true;
    return this;
  }

  maybeSingle(): this {
    this.state.maybeSingle = true;
    return this;
  }

  then<TResult1 = ShimResult, TResult2 = never>(
    onfulfilled?:
      | ((value: ShimResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    // execute() never rejects — errors are normalized into the result — so
    // the rejection handler exists only for PromiseLike conformance.
    // eslint-disable-next-line promise/prefer-catch
    return this.execute().then(onfulfilled, onrejected);
  }

  private pushFilter(
    path: string,
    op: string,
    value: unknown,
    negated = false
  ): this {
    this.state.filters.push({ path, op, value, negated });
    return this;
  }

  private async execute(): Promise<ShimResult> {
    try {
      return await this.executeUnsafe();
    } catch (error) {
      return {
        data: null,
        error: toShimError(error),
        count: null,
        status: 500,
        statusText: "Internal Server Error",
      };
    }
  }

  private async executeUnsafe(): Promise<ShimResult> {
    const { state } = this;
    if (state.op === "select") return this.executeSelect();

    if (
      (state.op === "update" || state.op === "delete") &&
      state.filters.length === 0 &&
      state.orFilters.length === 0
    ) {
      throw new Error(
        `postgrest-shim: refusing unfiltered ${state.op} on ${state.table}`
      );
    }
    if (state.op === "update") return this.executeUpdate();
    if (state.op === "delete") return this.executeDelete();
    return this.executeInsert(state.op === "upsert");
  }

  // -- SELECT ---------------------------------------------------------------

  private splitEmbedFilters(parsed: ParsedSelect): {
    tableFilters: Filter[];
    embedFilters: Map<string, Filter[]>;
  } {
    const embedNames = new Set(parsed.embeds.map((embed) => embed.alias));
    const tableFilters: Filter[] = [];
    const embedFilters = new Map<string, Filter[]>();
    for (const filter of this.state.filters) {
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

  private async buildEmbedSubquery(
    parentTable: string,
    parentQualifier: string,
    embed: ParsedEmbed,
    filters: Filter[],
    sql: SqlBuilder
  ): Promise<string> {
    const relationship = await this.schema.getRelationship(
      parentTable,
      embed.table
    );
    const childQualifier = quoteIdent(`__embed_${embed.alias}`);
    const childSelectList = await this.buildSelectList(
      embed.table,
      childQualifier,
      embed.select,
      new Map(),
      sql
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

  private async buildSelectList(
    table: string,
    qualifier: string,
    parsed: ParsedSelect,
    embedFilters: Map<string, Filter[]>,
    sql: SqlBuilder
  ): Promise<string> {
    const parts: string[] = [];
    for (const field of parsed.fields) {
      parts.push(
        field === "*" ? `${qualifier}.*` : compileColumnPath(field, qualifier)
      );
    }
    for (const embed of parsed.embeds) {
      parts.push(
        await this.buildEmbedSubquery(
          table,
          qualifier,
          embed,
          embedFilters.get(embed.alias) ?? [],
          sql
        )
      );
    }
    if (parts.length === 0) parts.push(`${qualifier}.*`);
    return parts.join(", ");
  }

  private async buildWhere(
    qualifier: string,
    tableFilters: Filter[],
    parsed: ParsedSelect | null,
    embedFilters: Map<string, Filter[]>,
    sql: SqlBuilder
  ): Promise<string> {
    const conditions: string[] = tableFilters.map((filter) =>
      compileFilter(filter, qualifier, sql)
    );
    for (const group of this.state.orFilters) {
      const parts = group.map((filter) =>
        compileFilter(filter, qualifier, sql)
      );
      conditions.push(`(${parts.join(" OR ")})`);
    }
    // !inner embeds constrain parent rows to those with a matching embed row.
    // Filters on non-inner embeds only filter the embed's own content, which
    // buildEmbedSubquery already handles.
    for (const embed of parsed?.embeds ?? []) {
      if (!embed.inner) continue;
      const scoped = embedFilters.get(embed.alias) ?? [];
      const relationship = await this.schema.getRelationship(
        this.state.table,
        embed.table
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

  private buildOrderLimit(qualifier: string): string {
    const { orders, limit, offset } = this.state;
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

  private async executeSelect(): Promise<ShimResult> {
    const { state } = this;
    const parsed = parseSelect(state.select ?? "*");
    const qualifier = quoteIdent(state.table);
    const { tableFilters, embedFilters } = this.splitEmbedFilters(parsed);

    let count: number | null = null;
    if (state.countMode === "exact") {
      const countSql = new SqlBuilder();
      const where = await this.buildWhere(
        qualifier,
        tableFilters,
        parsed,
        embedFilters,
        countSql
      );
      const { rows } = await this.db.query(
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
    const selectList = await this.buildSelectList(
      state.table,
      qualifier,
      parsed,
      embedFilters,
      sql
    );
    const where = await this.buildWhere(
      qualifier,
      tableFilters,
      parsed,
      embedFilters,
      sql
    );
    const { rows } = await this.db.query(
      `select ${selectList} from ${qualifier}${where}${this.buildOrderLimit(qualifier)}`,
      sql.params
    );
    return this.shapeRows(rows, count, 200);
  }

  // -- WRITES ---------------------------------------------------------------

  private async castValue(
    table: string,
    column: string,
    value: unknown,
    sql: SqlBuilder
  ): Promise<string> {
    const types = await this.schema.getColumnTypes(table);
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

  private async executeInsert(upsert: boolean): Promise<ShimResult> {
    const { state } = this;
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
          await this.castValue(state.table, column, row[column], sql)
        );
      }
      valueRows.push(`(${values.join(", ")})`);
    }
    let statement = `insert into ${quoteIdent(state.table)} (${columns
      .map(quoteIdent)
      .join(", ")}) values ${valueRows.join(", ")}`;
    if (upsert) {
      const conflictCols = (
        state.onConflict ??
        (await this.schema.getPrimaryKey(state.table)).join(",")
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
                .map(
                  (col) => `${quoteIdent(col)} = excluded.${quoteIdent(col)}`
                )
                .join(", ")}`
            : ` on conflict (${conflictCols.map(quoteIdent).join(", ")}) do nothing`;
      }
    }
    return this.executeWrite(statement, sql, 201);
  }

  private async executeUpdate(): Promise<ShimResult> {
    const { state } = this;
    const values = state.updateValues ?? {};
    const sql = new SqlBuilder();
    const assignments: string[] = [];
    for (const [column, value] of Object.entries(values)) {
      assignments.push(
        `${quoteIdent(column)} = ${await this.castValue(state.table, column, value, sql)}`
      );
    }
    const qualifier = quoteIdent(state.table);
    const where = await this.buildWhere(
      qualifier,
      this.state.filters,
      null,
      new Map(),
      sql
    );
    return this.executeWrite(
      `update ${qualifier} set ${assignments.join(", ")}${where}`,
      sql,
      200
    );
  }

  private async executeDelete(): Promise<ShimResult> {
    const qualifier = quoteIdent(this.state.table);
    const sql = new SqlBuilder();
    const where = await this.buildWhere(
      qualifier,
      this.state.filters,
      null,
      new Map(),
      sql
    );
    return this.executeWrite(`delete from ${qualifier}${where}`, sql, 200);
  }

  private async executeWrite(
    statement: string,
    sql: SqlBuilder,
    successStatus: number
  ): Promise<ShimResult> {
    const { state } = this;
    if (state.select !== null) {
      const parsed = parseSelect(state.select || "*");
      if (parsed.embeds.length > 0) {
        throw new Error(
          "postgrest-shim: embedded resources are not supported in write RETURNING"
        );
      }
      const returning = parsed.fields
        .map((field) =>
          field === "*"
            ? "*"
            : compileColumnPath(field, quoteIdent(state.table))
        )
        .join(", ");
      const { rows } = await this.db.query(
        `${statement} returning ${returning}`,
        sql.params
      );
      return this.shapeRows(rows, null, successStatus);
    }
    await this.db.query(statement, sql.params);
    return {
      data: null,
      error: null,
      count: null,
      status: successStatus === 201 ? 201 : 204,
      statusText: successStatus === 201 ? "Created" : "No Content",
    };
  }

  private shapeRows(
    rows: Record<string, unknown>[],
    count: number | null,
    status: number
  ): ShimResult {
    const { single, maybeSingle } = this.state;
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
}

// ---------------------------------------------------------------------------
// rpc

type FunctionShape = {
  returnsSet: boolean;
  returnsVoid: boolean;
  returnsComposite: boolean;
  name: string;
};

async function getFunctionShape(
  db: Queryable,
  cache: Map<string, FunctionShape>,
  name: string
): Promise<FunctionShape> {
  const cached = cache.get(name);
  if (cached) return cached;
  const { rows } = await db.query(
    `select p.proretset as returns_set,
            t.typname as type_name,
            t.typtype as type_type
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname = $1
     limit 1`,
    [name]
  );
  if (rows.length === 0) {
    throw new Error(`postgrest-shim: unknown function ${JSON.stringify(name)}`);
  }
  const shape: FunctionShape = {
    name,
    returnsSet: Boolean(rows[0].returns_set),
    returnsVoid: rows[0].type_name === "void",
    returnsComposite:
      rows[0].type_type === "c" || rows[0].type_name === "record",
  };
  cache.set(name, shape);
  return shape;
}

// ---------------------------------------------------------------------------
// Public factory

export type PostgrestShim = {
  from: (table: string) => PostgrestShimBuilder;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<ShimResult>;
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{
        data: { user: Record<string, unknown> | null };
        error: ShimError | null;
      }>;
    };
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: ArrayBuffer | Uint8Array,
        options?: { contentType?: string; upsert?: boolean }
      ) => Promise<{ data: { path: string } | null; error: ShimError | null }>;
      list: (
        prefix?: string,
        options?: {
          limit?: number;
          offset?: number;
          sortBy?: { column: string; order: string };
        }
      ) => Promise<{
        data: { name: string; updated_at: string | null }[] | null;
        error: ShimError | null;
      }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

export function createPostgrestShim(db: Queryable): PostgrestShim {
  const schema = new SchemaCache(db);
  const functionShapes = new Map<string, FunctionShape>();

  return {
    from(table: string) {
      return new PostgrestShimBuilder(db, schema, table);
    },

    async rpc(name, args = {}) {
      try {
        const shape = await getFunctionShape(db, functionShapes, name);
        const sql = new SqlBuilder();
        const argList = Object.entries(args)
          .map(([key, value]) => {
            // Dates must stay scalar: a `::jsonb` cast makes Postgres unable
            // to resolve functions with timestamptz parameters (jsonb has no
            // implicit cast), failing the whole call.
            const param =
              value instanceof Date
                ? sql.add(value.toISOString())
                : value !== null &&
                    typeof value === "object" &&
                    !Array.isArray(value)
                  ? `${sql.add(JSON.stringify(value))}::jsonb`
                  : sql.add(value);
            return `${quoteIdent(key)} => ${param}`;
          })
          .join(", ");
        const call = `${quoteIdent(name)}(${argList})`;

        if (shape.returnsVoid) {
          await db.query(`select ${call}`, sql.params);
          return {
            data: null,
            error: null,
            count: null,
            status: 204,
            statusText: "No Content",
          };
        }
        if (shape.returnsSet || shape.returnsComposite) {
          const { rows } = await db.query(`select * from ${call}`, sql.params);
          // PostgREST returns a setof-scalar function as a bare value array,
          // not an array of single-key row objects.
          const data = shape.returnsSet
            ? shape.returnsComposite
              ? rows
              : rows.map((row) => row[name] ?? Object.values(row)[0])
            : (rows[0] ?? null);
          return {
            data,
            error: null,
            count: null,
            status: 200,
            statusText: "OK",
          };
        }
        const { rows } = await db.query(`select ${call} as value`, sql.params);
        return {
          data: rows[0]?.value ?? null,
          error: null,
          count: null,
          status: 200,
          statusText: "OK",
        };
      } catch (error) {
        return {
          data: null,
          error: toShimError(error),
          count: null,
          status: 500,
          statusText: "Internal Server Error",
        };
      }
    },

    auth: {
      admin: {
        async getUserById(id) {
          try {
            // better-auth's "user" table is the identity source on Neon (the
            // data copy preserves Supabase auth uids as its ids).
            const { rows } = await db.query(
              `select id, email, name, image from "user" where id = $1`,
              [id]
            );
            const row = rows[0];
            if (!row) {
              return {
                data: { user: null },
                error: {
                  message: "User not found",
                  code: "user_not_found",
                  details: null,
                  hint: null,
                },
              };
            }
            return {
              data: {
                user: {
                  id: row.id,
                  email: row.email,
                  user_metadata: {
                    name: row.name ?? null,
                    avatar_url: row.image ?? null,
                  },
                },
              },
              error: null,
            };
          } catch (error) {
            return { data: { user: null }, error: toShimError(error) };
          }
        },
      },
    },

    storage: {
      from(bucket: string) {
        return {
          async upload(path, body, options = {}) {
            try {
              const bytes = Buffer.isBuffer(body)
                ? body
                : Buffer.from(
                    body instanceof ArrayBuffer ? new Uint8Array(body) : body
                  );
              const conflictAction = options.upsert
                ? `do update set data = excluded.data, content_type = excluded.content_type, updated_at = now()`
                : `do nothing`;
              await db.query(
                `insert into storage_objects (bucket, name, content_type, data)
                 values ($1, $2, $3, $4)
                 on conflict (bucket, name) ${conflictAction}`,
                [
                  bucket,
                  path,
                  options.contentType ?? "application/octet-stream",
                  bytes,
                ]
              );
              return { data: { path }, error: null };
            } catch (error) {
              return { data: null, error: toShimError(error) };
            }
          },
          async list(prefix = "", options = {}) {
            try {
              const sql = new SqlBuilder();
              let where = `bucket = ${sql.add(bucket)}`;
              if (prefix) {
                where += ` and name like ${sql.add(`${prefix}%`)}`;
              }
              const order =
                options.sortBy?.order?.toLowerCase() === "desc"
                  ? "desc"
                  : "asc";
              let statement = `select name, updated_at from storage_objects where ${where} order by name ${order}`;
              if (options.limit !== undefined) {
                statement += ` limit ${Math.floor(options.limit)}`;
              }
              if (options.offset !== undefined) {
                statement += ` offset ${Math.floor(options.offset)}`;
              }
              const { rows } = await db.query(statement, sql.params);
              return {
                data: rows.map((row) => ({
                  name: String(row.name),
                  updated_at:
                    row.updated_at instanceof Date
                      ? row.updated_at.toISOString()
                      : ((row.updated_at as string | null) ?? null),
                })),
                error: null,
              };
            } catch (error) {
              return { data: null, error: toShimError(error) };
            }
          },
          getPublicUrl(path: string) {
            // Served by app/storage/... so existing /storage/v1 URL shapes
            // keep working against the app origin instead of Supabase.
            return {
              data: {
                publicUrl: `/storage/v1/object/public/${bucket}/${path}`,
              },
            };
          },
        };
      },
    },
  };
}
