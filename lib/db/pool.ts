// Shared Neon pg pool for the PostgREST shim. Lazy so importing the module
// without DATABASE_URL (CI builds, Supabase-backend deployments) stays
// side-effect-free — the pool only connects on first query.
import { Pool, types } from "pg";
import { getRuntimeDatabaseUrl } from "@/lib/db/connection-urls";

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

// Postgres text output for timestamps uses a space separator and abbreviates
// whole-hour zone offsets ("2026-08-03 15:00:20.638+00"); PostgREST emits
// ISO-8601 with a full offset ("2026-08-03T15:00:20.638+00:00").
const isoTimestamp = (value: string) => value.replace(" ", "T");

const isoTimestamptz = (value: string) => {
  const iso = isoTimestamp(value);
  return /[+-]\d{2}$/.test(iso) ? `${iso}:00` : iso;
};

const keepString = (value: string) => value;

const stringArray = (transform: (value: string) => string) => {
  // Oid 1009 (text[]) borrows pg's array grammar with elements left as
  // strings, so any element transform can be applied verbatim.
  const parseTextArray = defaultTextParser(1009);
  return (value: string) =>
    (parseTextArray(value) as (string | null)[]).map((element) =>
      element === null ? null : transform(element)
    );
};

// PostgREST serializes numeric and bigint as JSON numbers; node-pg's default
// text parsers return strings to avoid precision loss. Every call site was
// written against PostgREST's behavior (`.toFixed` on cost columns crashed
// post-flip), so match it — precision semantics are the same IEEE-754 limits
// PostgREST's JSON output already had. Embeds are unaffected either way:
// row_to_json/json_agg serialize numbers inside Postgres.
//
// Timestamps and dates get the same treatment: node-pg decodes them to JS
// Date objects, but PostgREST always returned ISO-8601 strings. A Date
// leaking out of the shim breaks string call sites and, worse, round-trips
// back into rpc() args as `::jsonb` — which made Postgres unable to resolve
// claim_automation_job_run (jsonb has no implicit cast to timestamptz) and
// stalled every automation start post-flip.
// Exported so the PGlite test battery installs the identical parsers.
export const SHIM_TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  20: toNumber, // int8
  1700: toNumber, // numeric
  1016: numberArray(1016), // int8[]
  1231: numberArray(1231), // numeric[]
  1082: keepString, // date
  1114: isoTimestamp, // timestamp
  1184: isoTimestamptz, // timestamptz
  1182: stringArray(keepString), // date[]
  1115: stringArray(isoTimestamp), // timestamp[]
  1185: stringArray(isoTimestamptz), // timestamptz[]
};

let pool: Pool | null = null;

export function getNeonPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getRuntimeDatabaseUrl(),
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
