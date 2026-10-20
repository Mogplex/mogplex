import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getNeonPool } from "@/lib/db/pool";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";

type AdminConnectionRunnerDeps = {
  getDataBackend: () => string | undefined;
  getPool: typeof getNeonPool;
  createShim: typeof createPostgrestShim;
  defaultClient: SupabaseClient;
};

let cached: SupabaseClient | null = null;

/** True only when a unit test explicitly opts into the supabase-js REST fixture transport. */
function usesSupabaseRestTransport(
  backend: string | undefined = process.env.MOGPLEX_DATA_BACKEND
) {
  return backend === "supabase";
}

function resolveAdminClient(): SupabaseClient {
  if (cached) return cached;
  // Production data lives in Neon: every supabaseAdmin call goes through the
  // pg-backed PostgREST shim. The Supabase project is retired.
  //
  // The supabase-js REST client is kept only as a unit-test transport: tests
  // opt in with MOGPLEX_DATA_BACKEND=supabase plus a fake SUPABASE_URL and a
  // fetch mock. Nothing deployed sets that value, and an unset flag means Neon.
  //
  // The shim implements the subset of the supabase-js surface this codebase
  // uses (enforced by the tests/db battery); the cast erases the difference
  // for the 150+ existing call sites.
  cached = usesSupabaseRestTransport()
    ? createClient(
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
          process.env.SUPABASE_SECRET_KEY!
      )
    : (createPostgrestShim(getNeonPool()) as unknown as SupabaseClient);
  return cached;
}

// Lazy so importing this module is side-effect-free: proxy.ts and unit tests
// import it without backend env configured, and the client (pg shim, or the
// unit-test REST transport) is only constructed on first actual use. Properties defined
// directly on the export (unit tests stub `from` via Object.defineProperty)
// win over the resolved client.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    if (Object.hasOwn(target, prop)) {
      return Reflect.get(target, prop);
    }
    const client = resolveAdminClient();
    const value = Reflect.get(client as object, prop);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});

export function createSupabaseAdminConnectionRunner(
  overrides: Partial<AdminConnectionRunnerDeps> = {}
) {
  const deps: AdminConnectionRunnerDeps = {
    getDataBackend: () => process.env.MOGPLEX_DATA_BACKEND,
    getPool: getNeonPool,
    createShim: createPostgrestShim,
    defaultClient: supabaseAdmin,
    ...overrides,
  };

  return async function withSupabaseAdminConnection<T>(
    operation: (client: SupabaseClient) => Promise<T>
  ): Promise<T> {
    if (usesSupabaseRestTransport(deps.getDataBackend())) {
      return operation(deps.defaultClient);
    }

    const connection = await deps.getPool().connect();
    try {
      const client = deps.createShim(connection) as unknown as SupabaseClient;
      return await operation(client);
    } finally {
      connection.release();
    }
  };
}

export const withSupabaseAdminConnection =
  createSupabaseAdminConnectionRunner();
