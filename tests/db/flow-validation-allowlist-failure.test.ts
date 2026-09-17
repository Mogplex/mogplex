import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createFlowPublishPostHandler } from "@/app/api/flows/[id]/publish/route";
import { createAutomationValidateHandler } from "@/app/api/v1/mogplex/automations/validate/route";
import { createMogplexApiAutomationPublishPostHandler } from "@/app/api/v1/mogplex/automations/[automationId]/publish/route";
import { coerceGraph } from "@/lib/flows/graph";
import { publishFlowDraft } from "@/lib/flows/server-publish";
import { validateFlowConfiguration } from "@/lib/flows/server-validation";
import { MogplexApiClient } from "@/lib/mogplex-api/client";
import { callMogplexTool } from "@/lib/mogplex-api/mcp-handlers";
import { scheduledTaskExample } from "@/lib/mogplex-api/automation-schema";
import {
  ACTIVE_TEAM_HEADER,
  MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
} from "@/lib/team-capabilities";
import { createAutomationDb, AGENT_ID } from "./helpers/mcp-automation-fixture";

const teamId = "44444444-4444-4444-8444-444444444444";
const auth = async () => ({
  ok: true as const,
  auth: { userId: "owner", keyId: "test", scopes: ["read", "write"] },
});

it.each([null, "openai/test-model"])(
  "allowlist outage with model %s stays retryable through publishing and MCP",
  async (modelOverride) => {
    const db = await createAutomationDb();
    try {
      await db.pg.exec(`
        create table team_members(team_id uuid, user_id text, role text);
        create table team_provider_keys(team_id uuid, provider text, created_at timestamptz, updated_at timestamptz);
        insert into team_members values ('${teamId}', 'owner', 'owner');
      `);
      // No teams table: the real allowlist query fails instead of returning an
      // unrestricted team. Keep the rest of the graph valid.
      const graph = coerceGraph(structuredClone(scheduledTaskExample));
      const agent = graph.nodes.find((node) => node.type === "agent")!;
      agent.data.agentId = AGENT_ID;
      agent.data.modelOverride = modelOverride;
      const flowId = (
        await db.pg.query<{ id: string }>(
          "insert into flows(user_id,installation_id,draft_graph) values('owner',123,$1) returning id",
          [JSON.stringify(graph)]
        )
      ).rows[0].id;
      await expect(
        validateFlowConfiguration("owner", graph, 123, teamId)
      ).rejects.toMatchObject({ code: "MODEL_ALLOWLIST_UNAVAILABLE" });

      const publish = createFlowPublishPostHandler({
        requireUserId: async () => "owner",
      });
      const response = await publish(
        new Request("https://mogplex.test/api/flows/flow/publish", {
          method: "POST",
          headers: { [ACTIVE_TEAM_HEADER]: teamId },
        }),
        { params: Promise.resolve({ id: flowId }) }
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(await response.json()).toMatchObject({
        error: MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
      });

      // MCP is personal-scoped today. Supply team scope at the service seam to
      // exercise its HTTP/client/tool error envelope with the real DB failure.
      const validate = createAutomationValidateHandler({
        resolveApiKey: auth,
        validate: (userId, value, installationId) =>
          validateFlowConfiguration(userId, value, installationId, teamId),
      });
      const publishMcp = createMogplexApiAutomationPublishPostHandler({
        resolveApiKey: auth,
        publishAutomation: async (userId, id) => {
          await publishFlowDraft(userId, id, teamId);
          throw new Error("Publishing must fail before this point");
        },
      });
      const client = new MogplexApiClient({
        baseUrl: "https://mogplex.test",
        authorization: "mog_test",
        fetch: async (url, init) => {
          const request = new NextRequest(String(url), {
            ...init,
            signal: init?.signal ?? undefined,
          });
          const result = String(url).endsWith("/validate")
            ? await validate(request)
            : await publishMcp(request, {
                params: Promise.resolve({ automationId: flowId }),
              });
          expect(result.status).toBe(503);
          expect(result.headers.get("retry-after")).toBe("5");
          return result;
        },
      });
      for (const [tool, args] of [
        ["mogplex_validate_automation", { graph, installationId: 123 }],
        ["mogplex_publish_automation", { automationId: flowId }],
      ] as const) {
        const result = await callMogplexTool(tool, args, { client });
        expect(result.isError).toBe(true);
        expect(result.structuredContent?.error).toMatchObject({
          code: "SERVICE_UNAVAILABLE",
          message: MODEL_ALLOWLIST_UNAVAILABLE_ERROR,
        });
        expect(JSON.stringify(result)).not.toMatch(/relation|does not exist/);
        expect(result.structuredContent?.validation).toBeUndefined();
      }
      expect((await db.pg.query("select * from flow_versions")).rows).toEqual(
        []
      );
      expect(
        (
          await db.pg.query(
            "select status,published_version_id,trigger_schedule_id from flows"
          )
        ).rows
      ).toEqual([
        {
          status: "inactive",
          published_version_id: null,
          trigger_schedule_id: null,
        },
      ]);
      expect(
        db.statements.every(
          (sql) => !/^(insert|update|delete)\b/i.test(sql.trim())
        )
      ).toBe(true);
    } finally {
      await db.close();
    }
  }
);
