// Shared types and error helpers for the PostgREST shim.
import { isSchemaDriftError, SCHEMA_DRIFT_MESSAGE } from "@/lib/schema-drift";

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

export type PgError = Error & {
  code?: string;
  detail?: string;
  hint?: string;
  constraint?: string;
};

export function toShimError(error: unknown): ShimError {
  const pgError = error as PgError;
  if (isSchemaDriftError(error)) {
    // Keep diagnostics on the server, while retaining SQLSTATE for callers
    // that deliberately support an optional table or an older schema.
    console.error("[schema-drift] Database contract mismatch", {
      code: pgError.code,
      message: pgError.message,
    });
    return {
      message: SCHEMA_DRIFT_MESSAGE,
      code: pgError.code ?? "SCHEMA_DRIFT",
      details: null,
      hint: null,
    };
  }
  return {
    message: pgError.message ?? String(error),
    code: pgError.code ?? "SHIM_ERROR",
    details: pgError.detail ?? null,
    hint: pgError.hint ?? null,
    ...(pgError.constraint ? { constraint: pgError.constraint } : {}),
  };
}

export function noRowsError(rowCount: number): ShimError {
  // PostgREST's code for "requested a single JSON object, got N != 1 rows" --
  // call sites check for it explicitly.
  return {
    message: `JSON object requested, multiple (or no) rows returned`,
    code: "PGRST116",
    details: `The result contains ${rowCount} rows`,
    hint: null,
  };
}
