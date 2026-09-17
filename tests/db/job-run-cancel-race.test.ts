import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { createPostgrestShim } from "@/lib/db/postgrest-shim";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { finalizeJobRunCancelled } from "@/lib/workflows/job-run-cancel-persistence";

it.each(["success", "failed", "deleted"] as const)(
  "cancellation reloads a job that becomes %s before the conditional update",
  async (status) => {
    const pg = await PGlite.create();
    const previousFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
    try {
      await pg.exec(`
        create table job_runs (
          id text primary key, status text, assignment_id text, trigger_id text,
          flow_id text, flow_version_id text, retry_of_job_run_id text,
          runtime_provider text, runtime_run_id text, workflow_run_id text,
          created_at timestamptz, started_at timestamptz, completed_at timestamptz,
          duration_ms integer, error text, cancel_requested_at timestamptz,
          cancelled_at timestamptz, cancel_reason text, cancel_error text, metadata jsonb
        );
        insert into job_runs(id,status,created_at,started_at)
          values ('job','running',now(),now());
      `);
      let raced = false;
      const db = createPostgrestShim({
        query: async (sql, values) => {
          // Commit completion between the initial read and guarded write.
          if (!raced && /^update\b/i.test(sql.trim())) {
            raced = true;
            await (status === "deleted"
              ? pg.query("delete from job_runs where id='job'")
              : pg.query(
                  "update job_runs set status=$1,completed_at=now() where id='job'",
                  [status]
                ));
          }
          const result = await pg.query(sql, values);
          return { rows: result.rows as Record<string, unknown>[] };
        },
      });
      Object.defineProperty(supabaseAdmin, "from", {
        configurable: true,
        value: db.from.bind(db),
      });
      const result = await finalizeJobRunCancelled({
        jobRunId: "job",
        cancelRequestedAt: new Date().toISOString(),
        cancelledAt: new Date().toISOString(),
        reason: "USER_REQUESTED",
        cancelError: null,
      });
      expect(raced).toBe(true);
      if (status === "deleted") {
        expect(result).toBeNull();
      } else {
        expect(result?.status).toBe(status);
        expect(result?.completed_at).not.toBeNull();
        expect(result?.cancelled_at).toBeNull();
        expect(
          (await pg.query("select status from job_runs where id='job'")).rows
        ).toEqual([{ status }]);
      }
    } finally {
      if (previousFrom)
        Object.defineProperty(supabaseAdmin, "from", previousFrom);
      else Reflect.deleteProperty(supabaseAdmin, "from");
      await pg.close();
    }
  }
);
