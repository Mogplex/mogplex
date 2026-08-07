// Storage shim for the PostgREST shim, backed by a storage_objects table.

import { SqlBuilder, type Queryable } from "../sql";
import type { ShimError } from "./types";
import { toShimError } from "./types";

export type StorageUploadResult = {
  data: { path: string } | null;
  error: ShimError | null;
};

export type StorageListResult = {
  data: { name: string; updated_at: string | null }[] | null;
  error: ShimError | null;
};

export type StorageBucket = {
  upload: (
    path: string,
    body: ArrayBuffer | Uint8Array,
    options?: { contentType?: string; upsert?: boolean }
  ) => Promise<StorageUploadResult>;
  list: (
    prefix?: string,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: { column: string; order: string };
    }
  ) => Promise<StorageListResult>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
};

export function createStorageShim(db: Queryable): {
  from: (bucket: string) => StorageBucket;
} {
  return {
    from(bucket: string): StorageBucket {
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
              options.sortBy?.order?.toLowerCase() === "desc" ? "desc" : "asc";
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
  };
}
