import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  buildRunRow,
  buildAiCall,
} from "../unit/helpers/mogplex-api-runs-fixtures";
import {
  createRunDeliveryStore,
  type DeliveryRun,
} from "@/lib/run-delivery/store";
import { createDeliveryResume } from "@/lib/run-delivery/resume";
import { refreshRunDelivery } from "@/lib/run-delivery/refresh";
import {
  queueResumeExternalAgentRun,
  type ResumeExternalAgentRunPayload,
  type ResumeExternalAgentRunDeps,
} from "@/lib/mogplex-api/run-resume";
import { deliverySnapshot } from "@/lib/run-delivery/fixtures.test-support";

export async function deliveryLifecycleFixture() {
  const db = new PGlite();
  const initial = {
    ...buildRunRow({
      id: randomUUID(),
      user_id: randomUUID(),
      repo_id: randomUUID(),
      ai_call_id: randomUUID(),
      status: "awaiting_input",
      metadata: { checkpoint_kind: "plan" },
      prompt: "Research, implement SSH signing, and open a PR",
      working_branch: "feature/signing",
    }),
    repo_full_name: "acme/widgets",
  };
  await db.exec(
    "CREATE TABLE repos(id uuid PRIMARY KEY, full_name text); CREATE TABLE external_agent_runs(id uuid PRIMARY KEY, user_id uuid, repo_id uuid, ai_call_id uuid, status text, runtime_provider text, runtime_run_id text, error text, metadata jsonb, updated_at timestamptz);"
  );
  await db.query("INSERT INTO repos VALUES ($1, $2)", [
    initial.repo_id,
    initial.repo_full_name,
  ]);
  await db.query(
    "INSERT INTO external_agent_runs VALUES ($1,$2,$3,$4,$5,null,null,null,$6,now())",
    [
      initial.id,
      initial.user_id,
      initial.repo_id,
      initial.ai_call_id,
      initial.status,
      JSON.stringify(initial.metadata),
    ]
  );
  const query = async (sql: string, values: unknown[]) => ({
    rows: (await db.query<DeliveryRun>(sql, values)).rows.map((row) => ({
      ...initial,
      ...row,
    })),
  });
  const store = createRunDeliveryStore(query);
  const current = async () => (await store.load(initial.user_id, initial.id))!;
  const queued: ResumeExternalAgentRunPayload[] = [];
  const keys = new Set<string>();
  const queue = (input: Parameters<typeof queueResumeExternalAgentRun>[0]) =>
    queueResumeExternalAgentRun(input, {
      isRuntimeConfigured: () => true,
      triggerTask: async (_task, payload, options) => {
        const key = String(options.idempotencyKey);
        if (!keys.has(key)) {
          keys.add(key);
          queued.push(payload);
        }
        return { id: `worker-${keys.size}` };
      },
    });
  let tick = 0;
  const snapshot = deliverySnapshot();
  snapshot.checks.state = "pending";
  snapshot.checks.failed = [];
  const loadGithub = async () => ({
    ...snapshot,
    observedAt: new Date(Date.UTC(2026, 10, 17, 0, 0, ++tick)).toISOString(),
  });
  const refreshDeps = { store, loadGithub, queueRepair: queue };
  const refresh = (run: DeliveryRun, repair = false) =>
    refreshRunDelivery(run, repair, refreshDeps);
  const launched: { branch: string; record: string | null; create: boolean }[] =
    [];
  const prompts: string[] = [];
  let passes = 0;
  const deps: ResumeExternalAgentRunDeps = {
    loadRun: async () => current(),
    updateRun: async (_owner, _id, update) => {
      const persisted = Object.entries(update).filter(([field]) =>
        [
          "ai_call_id",
          "status",
          "runtime_provider",
          "runtime_run_id",
          "error",
        ].includes(field)
      );
      if (persisted.length > 0)
        await db.query(
          `UPDATE external_agent_runs SET ${persisted.map(([field], index) => `${field} = $${index + 1}`).join(", ")}`,
          persisted.map(([, value]) => value)
        );
      return { ...(await current()), ...update };
    },
    createAiCall: async () =>
      buildAiCall({ id: randomUUID(), status: "pending" }),
    loadAiCall: async () => buildAiCall({ status: "success" }),
    appendEvent: async () => null,
    launchSandbox: async (run) => {
      launched.push({
        branch: run.working_branch,
        record: run.sandbox_record_id,
        create: run.create_branch,
      });
      return {
        recordId: initial.sandbox_record_id!,
        sandboxId: initial.sandbox_id!,
      };
    },
    runHarness: async (run) => {
      prompts.push(run.prompt);
      passes++;
      if (passes === 1)
        return {
          output:
            'Implemented signing.\n<<<MOGPLEX_CHECKPOINT>>>\n{"kind":"review","summary":"Signing implemented and tested.","previewUrl":null}\n<<<END_MOGPLEX_CHECKPOINT>>>',
        };
      if (passes === 3) {
        snapshot.pullRequest!.headSha = "head-2";
        snapshot.repairRevision = "revision-2";
        snapshot.checks.state = "pending";
        snapshot.checks.failed = [];
      }
      return {
        output:
          passes === 2
            ? "Opened PR #42."
            : "Fixed the failing checks and pushed PR #42.",
      };
    },
    recordCheckpoint: async (_run, values) => {
      await db.query(
        "UPDATE external_agent_runs SET metadata = metadata || $1::jsonb",
        [JSON.stringify(values)]
      );
    },
    recordTerminalCommit: async () => {},
    notifyRunCheckpoint: async () => {},
    notifyRunReachedTerminalState: async () => {},
    refreshDelivery: async () => {
      await refresh(await current(), true);
    },
    delivery: createDeliveryResume({
      store,
      loadGithub,
      cancelCall: async () => {},
    }),
  };
  return {
    db,
    initial,
    store,
    current,
    queued,
    queue,
    snapshot,
    refresh,
    deps,
    launched,
    prompts,
  };
}
