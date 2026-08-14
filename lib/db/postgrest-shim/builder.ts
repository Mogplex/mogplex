// Core PostgREST-compatible query builder class.

import { SchemaCache } from "../schema-cache";
import {
  parseOrString,
  type BooleanFilter,
  type Filter,
  type Queryable,
} from "../sql";
import type { ShimResult } from "./types";
import { toShimError } from "./types";
import { executeSelect } from "./builder-select";
import { executeDelete, executeInsert, executeUpdate } from "./builder-write";

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
  orFilters: BooleanFilter[][];
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
  isDistinct(path: string, value: unknown): this {
    return this.pushFilter(path, "isdistinct", value);
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
    // execute() never rejects -- errors are normalized into the result -- so
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
    if (state.op === "select") {
      return executeSelect(state, this.db, this.schema);
    }

    if (
      (state.op === "update" || state.op === "delete") &&
      state.filters.length === 0 &&
      state.orFilters.length === 0
    ) {
      throw new Error(
        `postgrest-shim: refusing unfiltered ${state.op} on ${state.table}`
      );
    }
    if (state.op === "update") {
      return executeUpdate(state, this.db, this.schema);
    }
    if (state.op === "delete") {
      return executeDelete(state, this.db, this.schema);
    }
    return executeInsert(state, this.db, this.schema, state.op === "upsert");
  }
}
