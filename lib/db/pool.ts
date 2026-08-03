// Shared Neon pg pool for the PostgREST shim. Lazy so importing the module
// without DATABASE_URL (CI builds, Supabase-backend deployments) stays
// side-effect-free — the pool only connects on first query.
import { Pool } from "pg";
import type { Queryable } from "./postgrest-shim";

let pool: Pool | null = null;

export function getNeonPool(): Queryable {
  if (!pool) {
    pool = new Pool({
      // mogplex_DATABASE_URL is the Neon Vercel-integration var (managed,
      // auto-rotating); unprefixed DATABASE_URL covers local dev and CI.
      connectionString:
        process.env.DATABASE_URL || process.env.mogplex_DATABASE_URL,
      max: 5,
    });
  }
  return pool;
}
