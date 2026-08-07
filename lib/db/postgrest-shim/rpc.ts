// RPC (remote procedure call) support for the PostgREST shim.

import { quoteIdent, SqlBuilder, type Queryable } from "../sql";
import type { ShimResult } from "./types";
import { toShimError } from "./types";

export type FunctionShape = {
  returnsSet: boolean;
  returnsVoid: boolean;
  returnsComposite: boolean;
  name: string;
};

export async function getFunctionShape(
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

export async function executeRpc(
  db: Queryable,
  functionShapes: Map<string, FunctionShape>,
  name: string,
  args: Record<string, unknown> = {}
): Promise<ShimResult> {
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
}
