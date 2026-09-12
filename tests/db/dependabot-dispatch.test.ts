import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { AI_CALL_TYPES } from "@/lib/ai-call-types";
import { handleDependabotAlert } from "@/lib/dependabot";
import {
  bindFlowGraphToScope,
  buildFlowStarterTemplateGraph,
} from "@/lib/flows/templates";
import { buildFlowWebhookJobs } from "@/app/api/webhooks/github/_lib/flow-job-builder";

const userId = "00000000-0000-4000-8000-000000000001";
const repoId = "00000000-0000-4000-8000-000000000002";
const flowId = "00000000-0000-4000-8000-000000000003";
const versionId = "00000000-0000-4000-8000-000000000004";
const migration = (name: string) =>
  readFile(
    new URL(`../../supabase/migrations/${name}.sql`, import.meta.url),
    "utf8"
  );

it.each(["neon", "supabase"])(
  "%s migrates alert telemetry while preserving every previous AI-call type",
  async (backend) => {
    const db = await PGlite.create();
    try {
      await db.exec(
        "create table ai_calls (id uuid default gen_random_uuid(), type text not null)"
      );
      await db.exec(await migration("20260722220000_ai_call_type_tag_push"));
      // Explicit red proof against the previous production constraint.
      await expect(
        db.query("insert into ai_calls(type) values ('dependabot_alert')")
      ).rejects.toThrow(/ai_calls_type_check/);
      const sql = await readFile(
        new URL(
          `../../${backend}/migrations/20260912191000_dependabot_alert_ai_calls.sql`,
          import.meta.url
        ),
        "utf8"
      );
      await db.exec(sql);
      for (const type of AI_CALL_TYPES)
        await db.query("insert into ai_calls(type) values ($1)", [type]);
      expect((await db.query("select * from ai_calls")).rows).toHaveLength(
        AI_CALL_TYPES.length
      );
      await expect(
        db.query("insert into ai_calls(type) values ('bogus')")
      ).rejects.toThrow(/ai_calls_type_check/);
      await db.exec(sql);
    } finally {
      await db.close();
    }
  }
);

it("routes a created alert into real SQL once and keeps later lifecycle deliveries separate", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create table repos (id uuid primary key, github_installation_id bigint);
      create table assignments (id uuid primary key, repo_id uuid);
      create table triggers (id uuid primary key, installation_id bigint);
      create table job_runs (id uuid primary key default gen_random_uuid(), assignment_id uuid, trigger_id uuid, retry_of_job_run_id uuid, flow_id uuid, flow_version_id uuid, status text, metadata jsonb, idempotency_key text unique);
      create table automation_dispatch_events (id uuid default gen_random_uuid(), user_id uuid, job_run_id uuid, assignment_id uuid, trigger_id uuid, flow_id uuid, flow_version_id uuid, repo_id uuid, installation_id bigint, source_kind text, source_type text, event_kind text, outcome text, reason text, metadata jsonb);
    `);
    await db.exec(
      await migration("20260329120000_automation_dispatch_flow_source_kind")
    );
    const graph = bindFlowGraphToScope(
      buildFlowStarterTemplateGraph({
        templateId: "dependabot-autopilot",
        agentId: "agent-1",
        agentName: "Remediator",
      }),
      { installationId: 123, repository: "acme/widgets" }
    );
    const start = graph.nodes.find((node) => node.type === "start")!;
    const input = {
      flows: [
        {
          id: flowId,
          user_id: userId,
          installation_id: 123,
          published_version_id: versionId,
          published_version: { id: versionId, graph },
        },
      ],
      repoRows: [{ id: repoId, user_id: userId, full_name: "acme/widgets" }],
      payload: "alert-created",
      deliveryId: "delivery-1",
      repoFullName: "acme/widgets",
      installationId: 123,
      accountType: "Organization" as const,
      agentSlugsById: new Map([["agent-1", "remediator"]]),
      results: handleDependabotAlert({
        action: "created",
        alert: {
          number: 17,
          state: "open",
          dependency: { package: { name: "widget", ecosystem: "npm" } },
        },
      }),
    };
    const [job] = buildFlowWebhookJobs(input);
    expect(job.scope).toMatchObject({
      sourceType: "dependabot_alert",
      repoId,
      installationId: 123,
    });
    const enqueue = async (candidate: typeof job) =>
      (
        await db.query<{
          job_run_id: string;
          outcome: string;
          reason: string | null;
        }>(
          `select * from enqueue_automation_job_run(p_user_id => $1, p_flow_id => $2, p_flow_version_id => $3, p_repo_id => $4, p_installation_id => $5, p_source_kind => 'flow', p_source_type => 'dependabot_alert', p_idempotency_key => $6, p_metadata => $7)`,
          [
            userId,
            flowId,
            versionId,
            repoId,
            123,
            candidate.idempotency_key,
            JSON.stringify(candidate.metadata),
          ]
        )
      ).rows[0];
    const [first, duplicate] = await Promise.all([enqueue(job), enqueue(job)]);
    expect(first.outcome).toBe("queued");
    expect(duplicate).toMatchObject({
      job_run_id: first.job_run_id,
      outcome: "suppressed",
      reason: "IDEMPOTENT_DUPLICATE",
    });
    const stored = (
      await db.query<{ metadata: typeof job.metadata }>(
        "select metadata from job_runs"
      )
    ).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].metadata).toMatchObject({
      alert_number: 17,
      dependency_package: "widget",
      repo_id: repoId,
      repo_full_name: "acme/widgets",
      installation_id: 123,
      webhook_action: "created",
    });
    const fixed = {
      ...input,
      deliveryId: "delivery-2",
      results: handleDependabotAlert({
        action: "fixed",
        alert: { number: 17, state: "fixed" },
      }),
    };
    expect(buildFlowWebhookJobs(fixed)).toEqual([]);
    start.data.dependabotAlertActions = ["fixed"];
    const [lifecycleJob] = buildFlowWebhookJobs(fixed);
    expect((await enqueue(lifecycleJob)).outcome).toBe("queued");
    expect(
      (
        await db.query<{
          status: string;
          metadata: { webhook_action: string };
        }>("select status,metadata from job_runs where id=$1", [
          first.job_run_id,
        ])
      ).rows[0]
    ).toMatchObject({
      status: "pending",
      metadata: { webhook_action: "created" },
    });
    expect(
      buildFlowWebhookJobs({ ...input, repoFullName: "other/repo" })
    ).toEqual([]);
  } finally {
    await db.close();
  }
});
