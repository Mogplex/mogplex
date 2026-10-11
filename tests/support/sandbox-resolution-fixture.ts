import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

type RunningSandbox = { id: string; status?: string; persistent?: boolean };
export const OWNED_REPO_ID = "00000000-0000-4000-8000-000000000001";

let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;
const originalFetch = global.fetch;
const originalSecret = process.env.INTERNAL_API_SECRET;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function installSandboxRows(
  running: RunningSandbox[],
  repoLookup?: { id: string } | null,
  repoLookupError: { message: string } | null = null
) {
  const resolvedRepoLookup =
    repoLookup === undefined ? { id: OWNED_REPO_ID } : repoLookup;
  let status: string | undefined;
  const rows = () =>
    running
      .filter((row) => !status || (row.status ?? "running") === status)
      .map((row) => ({ status: "running", persistent: true, ...row }));
  const sandboxQuery = {
    select: () => sandboxQuery,
    eq: (column: string, value: string) => {
      if (column === "status") status = value;
      return sandboxQuery;
    },
    order: async () => ({ data: running, error: null }),
    limit: async () => ({ data: running, error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
  };
  const repoQuery = {
    select: () => repoQuery,
    eq: () => repoQuery,
    maybeSingle: async () => ({
      data: resolvedRepoLookup,
      error: repoLookupError,
    }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: (table: string) =>
      table === "sandboxes" ? sandboxQuery : repoQuery,
  });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
});

afterAll(() => {
  if (originalSupabaseUrl === undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  if (originalServiceRoleKey === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "internal-secret";
  installSandboxRows([]);
});

afterEach(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = originalSecret;
});
