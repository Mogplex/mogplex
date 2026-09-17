import { expect, it } from "vitest";
import { cancelMogplexApiAutomationRun } from "@/lib/mogplex-api/automation-run-control";
import { createAutomationDb } from "./helpers/mcp-automation-fixture";

it("flow cancellation verifies both token ownership and job membership before mutation", async () => {
  const db = await createAutomationDb();
  try {
    const ownerFlow = (
      await db.pg.query<{ id: string }>(
        "insert into flows(user_id) values('owner') returning id"
      )
    ).rows[0].id;
    const foreignFlow = (
      await db.pg.query<{ id: string }>(
        "insert into flows(user_id) values('other') returning id"
      )
    ).rows[0].id;
    const runId = (
      await db.pg.query<{ id: string }>(
        "insert into job_runs(flow_id,status) values($1,'running') returning id",
        [foreignFlow]
      )
    ).rows[0].id;
    await expect(
      cancelMogplexApiAutomationRun("owner", foreignFlow, runId)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cancelMogplexApiAutomationRun("owner", ownerFlow, runId)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cancelMogplexApiAutomationRun(
        "owner",
        ownerFlow,
        "00000000-0000-4000-8000-000000000000"
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(
      db.statements.every(
        (sql) => !/^(insert|update|delete)\b/i.test(sql.trim())
      )
    ).toBe(true);
    expect(
      (
        await db.pg.query<{ status: string }>(
          "select status from job_runs where id=$1",
          [runId]
        )
      ).rows[0].status
    ).toBe("running");
  } finally {
    await db.close();
  }
});
