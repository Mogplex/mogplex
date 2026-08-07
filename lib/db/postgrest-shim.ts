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
import type { Queryable } from "./sql";
import { PostgrestShimBuilder } from "./postgrest-shim/builder";
import { executeRpc, type FunctionShape } from "./postgrest-shim/rpc";
import { createStorageShim } from "./postgrest-shim/storage";
import { createAuthShim } from "./postgrest-shim/auth";
import type { ShimError, ShimResult } from "./postgrest-shim/types";

// Re-export public types and utilities
export { parseSelect, type Queryable } from "./sql";
export type { ShimError, ShimResult } from "./postgrest-shim/types";

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
  const storageShim = createStorageShim(db);
  const authShim = createAuthShim(db);

  return {
    from(table: string) {
      return new PostgrestShimBuilder(db, schema, table);
    },

    async rpc(name, args = {}) {
      return executeRpc(db, functionShapes, name, args);
    },

    auth: authShim,
    storage: storageShim,
  };
}
