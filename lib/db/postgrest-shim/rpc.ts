// RPC (remote procedure call) support for the PostgREST shim.

import { quoteIdent, SqlBuilder, type Queryable } from "../sql";
import type { ShimResult } from "./types";
import { toShimError } from "./types";

export type FunctionShape = {
  returnsSet: boolean;
  returnsVoid: boolean;
  returnsComposite: boolean;
  name: string;
  argumentTypes: Record<string, string>;
};

function mapArgumentTypes(row: Record<string, unknown>) {
  const names = Array.isArray(row.argument_names) ? row.argument_names : [];
  const types = Array.isArray(row.argument_types) ? row.argument_types : [];
  const argumentTypes: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const type = types[index];
    if (typeof name === "string" && typeof type === "string") {
      argumentTypes[name] = type;
    }
  }
  return argumentTypes;
}

function addRpcArgument(
  sql: SqlBuilder,
  value: unknown,
  argumentType: string | undefined
) {
  if (
    value !== null &&
    value !== undefined &&
    (argumentType === "json" || argumentType === "jsonb")
  ) {
    return `${sql.add(JSON.stringify(value))}::${argumentType}`;
  }
  // Dates must stay scalar: a JSON cast prevents Postgres from resolving
  // functions with timestamptz parameters.
  return sql.add(value instanceof Date ? value.toISOString() : value);
}

function rpcData(
  shape: FunctionShape,
  rows: Record<string, unknown>[],
  name: string
): unknown {
  if (!shape.returnsSet) return rows[0] ?? null;
  if (shape.returnsComposite) return rows;
  return rows.map((row) => row[name] ?? Object.values(row)[0]);
}

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
            t.typtype as type_type,
            arguments.argument_names,
            arguments.argument_types
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
     left join lateral (
       select
         array_agg(argument.name order by argument.ordinality)
           filter (where argument.mode in ('i', 'b', 'v')) as argument_names,
         array_agg(
           pg_catalog.format_type(
             coalesce(nullif(argument_type.typbasetype, 0), argument_type.oid),
             null
           )
           order by argument.ordinality
         ) filter (where argument.mode in ('i', 'b', 'v')) as argument_types
       from unnest(
         coalesce(p.proallargtypes, p.proargtypes::oid[]),
         coalesce(
           p.proargmodes,
           pg_catalog.array_fill('i'::"char", array[p.pronargs::integer])
         ),
         p.proargnames
       ) with ordinality as argument(type_oid, mode, name, ordinality)
       join pg_catalog.pg_type argument_type on argument_type.oid = argument.type_oid
     ) arguments on true
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
    argumentTypes: mapArgumentTypes(rows[0]),
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
        const param = addRpcArgument(sql, value, shape.argumentTypes[key]);
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
      return {
        // PostgREST returns a setof-scalar function as a bare value array,
        // not an array of single-key row objects.
        data: rpcData(shape, rows, name),
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
