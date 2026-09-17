import { expect, it } from "vitest";
import { validateFlowConfiguration } from "@/lib/flows/server-validation";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";
import { coerceGraph } from "@/lib/flows/graph";
import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import { createAutomationDb, AGENT_ID } from "./helpers/mcp-automation-fixture";

it("preflight checks owned installations, repositories, agents and enabled models without writes", async () => {
  const db = await createAutomationDb();
  try {
    const graph = coerceGraph(structuredClone(scheduledTaskExample));
    const start = graph.nodes.find((node) => node.type === "start")!;
    start.data.filter = {
      scope: "org",
      installationIds: [123],
      repos: ["acme/widgets"],
    };
    const task = graph.nodes.find((node) => node.type === "agent")!;
    task.data.agentId = AGENT_ID;
    task.data.modelOverride = null;
    expect(await validateFlowConfiguration("owner", graph, 123)).toEqual({
      valid: true,
      errors: [],
    });
    task.data.modelOverride = "openai/test-model";
    expect(await validateFlowConfiguration("owner", graph, 123)).toEqual({
      valid: true,
      errors: [],
    });
    task.data.agentId = `preset:${PRECONFIGURED_AGENTS[0].name}`;
    expect((await validateFlowConfiguration("owner", graph, 123)).valid).toBe(
      true
    );
    task.data.agentId = "preset:NOT_A_TEMPLATE";
    expect((await validateFlowConfiguration("owner", graph, 123)).valid).toBe(
      false
    );
    task.data.agentId = AGENT_ID;
    expect(
      (await validateFlowConfiguration("owner", graph, 456)).errors.join(" ")
    ).toMatch(/Installation is not available/);
    start.data.filter.repos = ["other/private"];
    expect(
      (await validateFlowConfiguration("owner", graph, 123)).errors.join(" ")
    ).toMatch(/repositories are not available/);
    start.data.filter.repos = ["acme/widgets"];
    task.data.agentId = "33333333-3333-4333-8333-333333333333";
    expect((await validateFlowConfiguration("owner", graph, 123)).valid).toBe(
      false
    );
    task.data.agentId = AGENT_ID;
    task.data.modelOverride = "openai/nonexistent";
    expect(
      (await validateFlowConfiguration("owner", graph, 123)).errors.join(" ")
    ).toMatch(/Model.*not enabled and available/);
    task.data.modelOverride = "openai/test-model";
    task.data.fallbackModelOverride = "openai/nonexistent";
    expect((await validateFlowConfiguration("owner", graph, 123)).valid).toBe(
      false
    );
    task.data.fallbackModelOverride = null;
    await db.pg.exec(
      "insert into user_model_preferences values ('owner','openai/test-model',false)"
    );
    task.data.modelOverride = null;
    expect(
      (await validateFlowConfiguration("owner", graph, 123)).errors.join(" ")
    ).toMatch(/No enabled model is available/);
    expect((await validateFlowConfiguration("owner", graph, 123)).valid).toBe(
      false
    );
    expect(
      db.statements.every(
        (sql) => !/^(insert|update|delete)\b/i.test(sql.trim())
      )
    ).toBe(true);
    await db.pg.exec("drop table agents cascade");
    const unavailable = await validateFlowConfiguration("owner", graph, 123);
    expect(unavailable.errors.join(" ")).toContain(
      "Could not verify one or more agents"
    );
    expect(unavailable.errors.join(" ")).not.toMatch(/relation|does not exist/);
  } finally {
    await db.close();
  }
});
