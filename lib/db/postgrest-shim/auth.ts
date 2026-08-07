// Auth shim for the PostgREST shim, backed by better-auth's user table.

import type { Queryable } from "../sql";
import type { ShimError } from "./types";
import { toShimError } from "./types";

export type AuthGetUserResult = {
  data: { user: Record<string, unknown> | null };
  error: ShimError | null;
};

export type AuthAdmin = {
  getUserById: (id: string) => Promise<AuthGetUserResult>;
};

export function createAuthShim(db: Queryable): { admin: AuthAdmin } {
  return {
    admin: {
      async getUserById(id: string): Promise<AuthGetUserResult> {
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
  };
}
