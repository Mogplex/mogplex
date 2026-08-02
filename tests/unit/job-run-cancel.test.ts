import assert from "node:assert/strict";
import test from "node:test";

type JobRunRow = {
  id: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id: string | null;
  flow_version_id: string | null;
  retry_of_job_run_id: string | null;
  runtime_provider: "trigger" | "workflow" | null;
  runtime_run_id: string | null;
  workflow_run_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancel_error: string | null;
  metadata: Record<string, unknown> | null;
};

type RepoRow = {
  id: string;
  user_id: string;
};

type AssignmentRow = {
  id: string;
  repo_id: string;
};

type TriggerRow = {
  id: string;
  user_id: string;
};

type FlowRow = {
  id: string;
  user_id: string;
};

type FlowWaitRow = {
  id: string;
  job_run_id: string;
  status: "waiting" | "resumed" | "expired" | "cancelled";
  resume_payload: Record<string, unknown> | null;
};

async function loadJobRunCancelModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/workflows/job-run-cancel");
}

async function withPatchedCancellationStore<T>(
  input: {
    jobRuns: JobRunRow[];
    repos?: RepoRow[];
    assignments?: AssignmentRow[];
    triggers?: TriggerRow[];
    flows?: FlowRow[];
    flowWaits?: FlowWaitRow[];
    cancelImpl: (runId: string) => Promise<void>;
  },
  callback: (state: {
    jobRuns: JobRunRow[];
    flowWaits: FlowWaitRow[];
    dispatchEvents: Array<Record<string, unknown>>;
  }) => Promise<T>
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

  const [{ supabaseAdmin }, { supabaseAdmin: aliasedSupabaseAdmin }] =
    await Promise.all([
      import("../../lib/supabase/admin"),
      import("@/lib/supabase/admin"),
    ]);
  const { runs } = await import("@trigger.dev/sdk/v3");

  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  const originalAliasedFrom =
    aliasedSupabaseAdmin.from.bind(aliasedSupabaseAdmin);
  const originalCancel = runs.cancel;

  const state = {
    jobRuns: input.jobRuns.map((row) => ({ ...row })),
    repos: (input.repos || []).map((row) => ({ ...row })),
    assignments: (input.assignments || []).map((row) => ({ ...row })),
    triggers: (input.triggers || []).map((row) => ({ ...row })),
    flows: (input.flows || []).map((row) => ({ ...row })),
    aiCalls: [] as Array<Record<string, unknown>>,
    flowNodeRuns: [] as Array<Record<string, unknown>>,
    flowWaits: (input.flowWaits || []).map((row) => ({ ...row })),
    dispatchEvents: [] as Array<Record<string, unknown>>,
  };

  function clone<TValue>(value: TValue): TValue {
    return JSON.parse(JSON.stringify(value)) as TValue;
  }

  function makeQuery(
    table:
      | "job_runs"
      | "repos"
      | "assignments"
      | "triggers"
      | "flows"
      | "ai_calls"
      | "flow_node_runs"
      | "flow_waits"
      | "automation_dispatch_events"
  ) {
    const rows =
      table === "job_runs"
        ? state.jobRuns
        : table === "repos"
          ? state.repos
          : table === "assignments"
            ? state.assignments
            : table === "triggers"
              ? state.triggers
              : table === "flows"
                ? state.flows
                : table === "ai_calls"
                  ? state.aiCalls
                  : table === "flow_node_runs"
                    ? state.flowNodeRuns
                    : table === "flow_waits"
                      ? state.flowWaits
                      : state.dispatchEvents;

    let updateValues: Record<string, unknown> | null = null;
    let insertValues: Record<string, unknown>[] | null = null;
    let selectOptions: { count?: "exact"; head?: boolean } | undefined;
    let selectedColumns: string | undefined;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];

    function getSelectError() {
      if (
        table === "job_runs" &&
        typeof selectedColumns === "string" &&
        selectedColumns.includes("user_id")
      ) {
        return { message: "column job_runs.user_id does not exist" };
      }

      return null;
    }

    const api = {
      select(_columns?: string, options?: { count?: "exact"; head?: boolean }) {
        selectedColumns = _columns;
        selectOptions = options;
        return api;
      },
      insert(values: Record<string, unknown> | Record<string, unknown>[]) {
        insertValues = Array.isArray(values) ? values : [values];
        return api;
      },
      update(values: Record<string, unknown>) {
        updateValues = values;
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return api;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);
        return api;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      or() {
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      async maybeSingle() {
        const selectError = getSelectError();
        if (selectError) {
          return { data: null, error: selectError };
        }
        if (insertValues) {
          for (const value of insertValues) {
            rows.push({ ...value } as never);
          }
          return {
            data: insertValues[0] ? clone(insertValues[0]) : null,
            error: null,
          };
        }
        const matches = rows.filter((row) =>
          filters.every((filter) => filter(row))
        );
        if (updateValues) {
          for (const row of matches) {
            Object.assign(row, updateValues);
          }
        }
        return {
          data: matches[0] ? clone(matches[0]) : null,
          error: null,
        };
      },
      async single() {
        const selectError = getSelectError();
        if (selectError) {
          return { data: null, error: selectError };
        }
        if (insertValues) {
          for (const value of insertValues) {
            rows.push({ ...value } as never);
          }
          return {
            data: clone(insertValues[0]),
            error: null,
          };
        }
        const matches = rows.filter((row) =>
          filters.every((filter) => filter(row))
        );
        if (updateValues) {
          for (const row of matches) {
            Object.assign(row, updateValues);
          }
        }
        return {
          data: clone(matches[0]),
          error: null,
        };
      },
      then(
        resolve: (value: {
          data: unknown[];
          error: { message: string } | null;
          count?: number | null;
        }) => unknown
      ) {
        const selectError = getSelectError();
        if (selectError) {
          return Promise.resolve(
            resolve({
              data: [],
              error: selectError,
              count: null,
            })
          );
        }
        if (insertValues) {
          for (const value of insertValues) {
            rows.push({ ...value } as never);
          }
          return Promise.resolve(
            resolve({
              data: clone(insertValues),
              error: null,
            })
          );
        }
        const matches = rows.filter((row) =>
          filters.every((filter) => filter(row))
        );
        if (updateValues) {
          for (const row of matches) {
            Object.assign(row, updateValues);
          }
        }
        return Promise.resolve(
          resolve({
            data: selectOptions?.head ? [] : clone(matches),
            error: null,
            count: selectOptions?.count === "exact" ? matches.length : null,
          })
        );
      },
    };

    return api;
  }

  const patchedFrom = (table: string) => {
    if (
      table === "job_runs" ||
      table === "repos" ||
      table === "assignments" ||
      table === "triggers" ||
      table === "flows" ||
      table === "ai_calls" ||
      table === "flow_node_runs" ||
      table === "flow_waits" ||
      table === "automation_dispatch_events"
    ) {
      return makeQuery(table);
    }
    throw new Error(`Unexpected table lookup: ${table}`);
  };

  for (const client of [supabaseAdmin, aliasedSupabaseAdmin]) {
    Object.defineProperty(client, "from", {
      configurable: true,
      writable: true,
      value: patchedFrom,
    });
  }

  Object.defineProperty(runs, "cancel", {
    configurable: true,
    writable: true,
    value: input.cancelImpl,
  });

  try {
    return await callback({
      jobRuns: state.jobRuns,
      flowWaits: state.flowWaits,
      dispatchEvents: state.dispatchEvents,
    });
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
    Object.defineProperty(aliasedSupabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalAliasedFrom,
    });
    Object.defineProperty(runs, "cancel", {
      configurable: true,
      writable: true,
      value: originalCancel,
    });
  }
}

test("cancelAutomationJobRun leaves running jobs requested-but-not-cancelled when Trigger cancellation fails", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-running",
          status: "running",
          assignment_id: null,
          trigger_id: null,
          flow_id: "flow-1",
          flow_version_id: "flow-version-1",
          retry_of_job_run_id: null,
          runtime_provider: "trigger",
          runtime_run_id: "run_123",
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {},
        },
      ],
      flows: [
        {
          id: "flow-1",
          user_id: "user-1",
        },
      ],
      cancelImpl: async () => {
        throw new Error("trigger cancel failed");
      },
    },
    async ({ jobRuns, dispatchEvents }) => {
      const { cancelAutomationJobRun } = await loadJobRunCancelModule();

      await assert.rejects(
        () => cancelAutomationJobRun("job-running"),
        /(trigger cancel failed|TRIGGER_SECRET_KEY)/
      );

      assert.equal(jobRuns[0]?.status, "running");
      assert.equal(typeof jobRuns[0]?.cancel_requested_at, "string");
      assert.equal(jobRuns[0]?.cancel_reason, "USER_REQUESTED");
      assert.match(
        jobRuns[0]?.cancel_error || "",
        /(trigger cancel failed|TRIGGER_SECRET_KEY)/
      );
      assert.equal(jobRuns[0]?.cancelled_at, null);
      assert.equal(jobRuns[0]?.completed_at, null);
      assert.deepEqual(
        dispatchEvents.map((event) => event.outcome),
        ["cancel_requested", "cancel_failed"]
      );
      assert.ok(dispatchEvents.every((event) => event.user_id === "user-1"));
    }
  );
});

test("cancelAutomationJobRun resolves assignment owners through the linked repo", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-assignment",
          status: "running",
          assignment_id: "assignment-1",
          trigger_id: null,
          flow_id: null,
          flow_version_id: null,
          retry_of_job_run_id: null,
          runtime_provider: "trigger",
          runtime_run_id: "run_assignment",
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {
            repo_id: "repo-1",
            source_type: "pr_review",
          },
        },
      ],
      assignments: [
        {
          id: "assignment-1",
          repo_id: "repo-1",
        },
      ],
      repos: [
        {
          id: "repo-1",
          user_id: "user-assignment",
        },
      ],
      cancelImpl: async () => {
        throw new Error("trigger cancel failed");
      },
    },
    async ({ dispatchEvents }) => {
      const { cancelAutomationJobRun } = await loadJobRunCancelModule();

      await assert.rejects(
        () => cancelAutomationJobRun("job-assignment"),
        /(trigger cancel failed|TRIGGER_SECRET_KEY)/
      );

      assert.deepEqual(
        dispatchEvents.map((event) => ({
          userId: event.user_id,
          outcome: event.outcome,
        })),
        [
          {
            userId: "user-assignment",
            outcome: "cancel_requested",
          },
          {
            userId: "user-assignment",
            outcome: "cancel_failed",
          },
        ]
      );
    }
  );
});

test("cancelAutomationJobRun still finalizes when the owner record has been deleted", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-missing-owner",
          status: "running",
          assignment_id: null,
          trigger_id: null,
          flow_id: "flow-deleted",
          flow_version_id: "flow-version-1",
          retry_of_job_run_id: null,
          runtime_provider: null,
          runtime_run_id: null,
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {},
        },
      ],
      flowWaits: [
        {
          id: "wait-1",
          job_run_id: "job-missing-owner",
          status: "waiting",
          resume_payload: null,
        },
      ],
      cancelImpl: async () => {},
    },
    async ({ jobRuns, flowWaits, dispatchEvents }) => {
      const { cancelAutomationJobRun } = await loadJobRunCancelModule();

      const result = await cancelAutomationJobRun("job-missing-owner");

      assert.equal(result.ok, true);
      if (!result.ok) {
        assert.fail("expected cancellation to succeed without an owner record");
      }

      assert.equal(jobRuns[0]?.status, "cancelled");
      assert.equal(jobRuns[0]?.cancel_reason, "USER_REQUESTED");
      assert.equal(flowWaits[0]?.status, "cancelled");
      assert.equal(flowWaits[0]?.resume_payload?.cancelled, true);
      assert.equal(dispatchEvents.length, 0);
    }
  );
});

test("reconcileAutomationJobRuns records a reconciled control event when it finalizes a missing runtime handle", async () => {
  const startedAt = "2026-03-29T12:00:00.000Z";

  await withPatchedCancellationStore(
    {
      jobRuns: [
        {
          id: "job-running",
          status: "running",
          assignment_id: null,
          trigger_id: "trigger-1",
          flow_id: null,
          flow_version_id: null,
          retry_of_job_run_id: null,
          runtime_provider: "trigger",
          runtime_run_id: null,
          workflow_run_id: null,
          created_at: startedAt,
          started_at: startedAt,
          completed_at: null,
          duration_ms: null,
          error: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          metadata: {
            repo_id: "repo-1",
            source_type: "pr_opened",
          },
        },
      ],
      triggers: [
        {
          id: "trigger-1",
          user_id: "user-1",
        },
      ],
      cancelImpl: async () => {},
    },
    async ({ jobRuns, dispatchEvents }) => {
      const { reconcileAutomationJobRuns } = await loadJobRunCancelModule();

      const results = await reconcileAutomationJobRuns(10);

      assert.deepEqual(results, [
        {
          jobRunId: "job-running",
          outcome: "failed",
          reason: "RECONCILED_MISSING_RUNTIME_HANDLE",
        },
      ]);
      assert.equal(jobRuns[0]?.status, "failed");
      assert.equal(jobRuns[0]?.error, "RECONCILED_MISSING_RUNTIME_HANDLE");
      assert.deepEqual(
        dispatchEvents.map((event) => ({
          userId: event.user_id,
          outcome: event.outcome,
          reason: event.reason,
        })),
        [
          {
            userId: "user-1",
            outcome: "reconciled",
            reason: "RECONCILED_MISSING_RUNTIME_HANDLE",
          },
        ]
      );
    }
  );
});
