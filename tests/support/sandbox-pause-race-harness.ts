import { PGlite } from "@electric-sql/pglite";
import { createPostgrestShim, type Queryable } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSandboxPauseHandler } from "@/app/api/sandbox/[id]/pause/route";
import { createSandboxDetailGetHandler } from "@/app/api/sandbox/[id]/route";
import { buildLoadedSandboxDetailRecord } from "../unit/sandbox-record-route-test-harness/record-builders";
import { buildResolvedSandboxRouteContext } from "../unit/sandbox-record-route-test-harness/context-builders";

export async function withDatabase(
  run: (pg: PGlite) => Promise<void>,
  recordId = "sandbox-1"
) {
  const pg = await PGlite.create();
  const previous = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
  try {
    await pg.exec(`create table sandboxes (
      id text primary key, sandbox_id text, status text, health_status text,
      persistent boolean, snapshot_id text, stop_reason text,
      last_active_at timestamptz default now() - interval '1 day'
    );`);
    await pg.query(
      "insert into sandboxes(id,sandbox_id,status,health_status,persistent,snapshot_id,stop_reason) values ($1,'vm_123','running','running',true,null,null)",
      [recordId]
    );
    const queryable: Queryable = {
      query: async (sql, values) => {
        const result = await pg.query(sql, values);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
    const db = createPostgrestShim(queryable);
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: db.from.bind(db),
    });
    await run(pg);
  } finally {
    if (previous) Object.defineProperty(supabaseAdmin, "from", previous);
    else Reflect.deleteProperty(supabaseAdmin, "from");
    await pg.close();
  }
}

export function buildRoutes(
  pg: PGlite,
  stop: () => Promise<void>,
  probe: () => Promise<string>,
  recordId = "sandbox-1"
) {
  const load = async () => {
    const { rows } = await pg.query<
      Parameters<typeof buildLoadedSandboxDetailRecord>[0]
    >("select * from sandboxes where id = $1", [recordId]);
    return buildLoadedSandboxDetailRecord({
      ...rows[0],
      working_branch: "main",
    });
  };
  const pause = createSandboxPauseHandler({
    loadOwnedSandboxRouteRecord: load as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded) as never,
    prepareSandboxBillingClose: async () => null,
    finalizeSandboxBillingClose: async () => ({
      finalized: true,
      metered: false,
    }),
    getSandbox: async () =>
      ({
        stop,
        currentSnapshotId: "snap_saved",
        currentSession: () => ({ stoppedAt: new Date() }),
      }) as never,
  });
  const detail = createSandboxDetailGetHandler({
    loadOwnedSandboxRouteRecord: load as never,
    resolveLoadedSandboxRouteContext: async (loaded) =>
      buildResolvedSandboxRouteContext(loaded, {
        sandbox: { status: await probe() },
      }) as never,
  });
  const params = { params: Promise.resolve({ id: recordId }) };
  return {
    pause: () =>
      pause(
        new Request(`http://localhost/api/sandbox/${recordId}/pause`, {
          method: "POST",
        }),
        params
      ),
    detail: () =>
      detail(new Request(`http://localhost/api/sandbox/${recordId}`), params),
  };
}
