// Shared Neon pg pool for the PostgREST shim. Lazy so importing the module
// without DATABASE_URL (CI builds, Supabase-backend deployments) stays
// side-effect-free — the pool only connects on first query.
import { Pool, types } from "pg";
import type { Queryable } from "./postgrest-shim";

const toNumber = Number;

const defaultTextParser = (oid: number) =>
  types.getTypeParser(oid as 20, "text") as (value: string) => unknown;

const numberArray = (oid: number) => {
  const parseArray = defaultTextParser(oid);
  return (value: string) =>
    (parseArray(value) as (string | null)[]).map((element) =>
      element === null ? null : Number(element)
    );
};

// PostgREST serializes numeric and bigint as JSON numbers; node-pg's default
// text parsers return strings to avoid precision loss. Every call site was
// written against PostgREST's behavior (`.toFixed` on cost columns crashed
// post-flip), so match it — precision semantics are the same IEEE-754 limits
// PostgREST's JSON output already had. Embeds are unaffected either way:
// row_to_json/json_agg serialize numbers inside Postgres.
// Exported so the PGlite test battery installs the identical parsers.
export const SHIM_TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  20: toNumber, // int8
  1700: toNumber, // numeric
  1016: numberArray(1016), // int8[]
  1231: numberArray(1231), // numeric[]
};

let pool: Pool | null = null;

export function getNeonPool(): Queryable {
  if (!pool) {
    pool = new Pool({
      // mogplex_DATABASE_URL is the Neon Vercel-integration var (managed,
      // auto-rotating); unprefixed DATABASE_URL covers local dev and CI.
      connectionString:
        process.env.DATABASE_URL || process.env.mogplex_DATABASE_URL,
      max: 5,
      types: {
        getTypeParser: (oid: number, format?: string) =>
          format === "binary"
            ? types.getTypeParser(oid as 20, "binary")
            : (SHIM_TYPE_PARSERS[oid] ?? defaultTextParser(oid)),
      } as never,
    });
  }
  return pool;
}
