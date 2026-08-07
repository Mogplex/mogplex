/**
 * Shared fixtures and helpers for job-run-cancel tests.
 */

export type JobRunRow = {
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

export type RepoRow = {
  id: string;
  user_id: string;
};

export type AssignmentRow = {
  id: string;
  repo_id: string;
};

export type TriggerRow = {
  id: string;
  user_id: string;
};

export type FlowRow = {
  id: string;
  user_id: string;
};

export type FlowWaitRow = {
  id: string;
  job_run_id: string;
  status: "waiting" | "resumed" | "expired" | "cancelled";
  resume_payload: Record<string, unknown> | null;
};

export async function loadJobRunCancelModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/workflows/job-run-cancel");
}

export async function withPatchedCancellationStore<T>(
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
      import("../../../lib/supabase/admin"),
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
