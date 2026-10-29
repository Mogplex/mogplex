import { afterEach, expect, it, vi } from "vitest";
import {
  createMogplexApiAutomation,
  publishMogplexApiAutomation,
} from "@/lib/mogplex-api/automations";
import { automationSchemaGuide } from "@/lib/mogplex-api/automation-schema";
import { coerceGraph } from "@/lib/flows/graph";
import { syncFlowActivation } from "@/lib/flows/server-publish";
import { createAutomationDb } from "./helpers/mcp-automation-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function setup(advanceOnCancel = false) {
  const db = await createAutomationDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-15T00:00:00Z"));
  vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_fixture");
  let requests = 0;
  const delays: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!url.hostname.endsWith("trigger.dev"))
        throw new Error("Unexpected network request");
      requests++;
      if (url.pathname.endsWith("/trigger")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          options?: { delay?: unknown };
        };
        delays.push(body.options?.delay);
      }
      if (advanceOnCancel && url.pathname.endsWith("/cancel"))
        vi.setSystemTime(Date.now() + 5000);
      return Response.json({
        id: `run_${requests}`,
        publicAccessToken: "fixture",
      });
    }
  );
  const graph = coerceGraph(
    structuredClone(automationSchemaGuide.examples.oneTimeTask)
  );
  graph.nodes.find((node) => node.type === "start")!.data.filter = {
    scope: "org",
    installationIds: [123],
    repos: ["acme/widgets"],
  };
  graph.nodes.find((node) => node.type === "start")!.data.scheduleRunAt =
    "2027-01-16T00:00:00Z";
  const agent = graph.nodes.find((node) => node.type === "agent")!;
  agent.data.harness = "codex";
  agent.data.agentId = null;
  const flow = await createMogplexApiAutomation("owner", {
    installationId: 123,
    graph,
  });
  await publishMogplexApiAutomation("owner", flow.id);
  return { db, graph, flow, requests: () => requests, delays };
}

it("rejects an already-past publish before changing its live version or trigger", async () => {
  const f = await setup();
  try {
    const before = (
      await f.db.pg.query(
        "select status,published_version_id,trigger_once_run_id from flows where id=$1",
        [f.flow.id]
      )
    ).rows[0];
    f.graph.nodes.find((node) => node.type === "start")!.data.scheduleRunAt =
      "2027-01-14T00:00:00Z";
    await f.db.pg.query("update flows set draft_graph=$2 where id=$1", [
      f.flow.id,
      JSON.stringify(f.graph),
    ]);
    const requests = f.requests();
    await expect(
      publishMogplexApiAutomation("owner", f.flow.id)
    ).rejects.toMatchObject({ code: "FLOW_GRAPH_INVALID" });
    expect(
      (
        await f.db.pg.query(
          "select status,published_version_id,trigger_once_run_id from flows where id=$1",
          [f.flow.id]
        )
      ).rows[0]
    ).toEqual(before);
    expect(f.requests()).toBe(requests);
  } finally {
    await f.db.close();
  }
});

it("a valid timestamp becoming due during trigger replacement still arms its dispatch", async () => {
  const f = await setup(true);
  try {
    f.graph.nodes.find((node) => node.type === "start")!.data.scheduleRunAt =
      new Date(Date.now() + 2000).toISOString();
    await f.db.pg.query("update flows set draft_graph=$2 where id=$1", [
      f.flow.id,
      JSON.stringify(f.graph),
    ]);
    await expect(
      publishMogplexApiAutomation("owner", f.flow.id)
    ).resolves.toMatchObject({ status: "active" });
    expect(f.requests()).toBe(3);
    expect(f.delays.at(-1)).toBeUndefined();
  } finally {
    await f.db.close();
  }
});

it("repeating activation leaves an already-armed, due dispatch intact", async () => {
  const f = await setup();
  try {
    vi.setSystemTime(new Date("2027-01-17T00:00:00Z"));
    await expect(
      syncFlowActivation("owner", f.flow.id, "active")
    ).resolves.toMatchObject({
      status: "active",
      trigger_once_run_id: "run_1",
    });
    expect(f.requests()).toBe(1);
  } finally {
    await f.db.close();
  }
});

it("re-enabling a past one-time schedule returns an input error and leaves it inactive", async () => {
  const f = await setup();
  try {
    await syncFlowActivation("owner", f.flow.id, "inactive");
    vi.setSystemTime(new Date("2027-01-17T00:00:00Z"));
    await expect(
      syncFlowActivation("owner", f.flow.id, "active")
    ).rejects.toMatchObject({ code: "FLOW_GRAPH_INVALID" });
    expect(
      (
        await f.db.pg.query(
          "select status,trigger_once_run_id from flows where id=$1",
          [f.flow.id]
        )
      ).rows[0]
    ).toEqual({ status: "inactive", trigger_once_run_id: null });
  } finally {
    await f.db.close();
  }
});
