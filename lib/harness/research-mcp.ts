import { z } from "zod";
import { asSchema } from "ai";
import { WEB_RESEARCH_INSTRUCTIONS } from "@/lib/agents/web-research-instructions";
import {
  webFetch,
  webFetchParams,
  webSearch,
  webSearchParams,
} from "@/lib/agents/tools/web";
import { verifyResearchToken, type ResearchClaims } from "./research-auth";
import type { Capability } from "@/lib/team-capabilities";
import { hasCapability } from "@/lib/team-capabilities";

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
const tools = {
  web_search: {
    tool: webSearch,
    schema: webSearchParams,
    capability: "tools.web_search" as const,
  },
  web_fetch: {
    tool: webFetch,
    schema: webFetchParams,
    capability: "tools.web_fetch" as const,
  },
};
export type ResearchMcpDeps = {
  /** Revalidate active run ownership and resolve its current team capabilities. */
  authorizeRun: (
    claims: ResearchClaims
  ) => Promise<ReadonlySet<Capability> | null>;
};

export function createResearchMcpPost(deps: ResearchMcpDeps) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const claims = verifyResearchToken(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
    );
    if (!claims) return reply({ error: "Unauthorized" }, 401);
    let capabilities: ReadonlySet<Capability> | null;
    try {
      capabilities = await deps.authorizeRun(claims);
    } catch {
      return reply({ error: "Research authorization unavailable" }, 503);
    }
    if (!capabilities) return reply({ error: "Run is no longer active" }, 403);
    let payload: z.infer<typeof requestSchema>;
    try {
      const text = await request.text();
      if (text.length > 16_000)
        return reply({ error: "Request too large" }, 413);
      payload = requestSchema.parse(JSON.parse(text));
    } catch {
      return reply(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid request" },
        },
        400
      );
    }
    const { id, method, params } = payload;
    if (id === undefined) return new Response(null, { status: 202 });
    const result = (value: unknown) =>
      reply({ jsonrpc: "2.0", id, result: value });
    const error = (code: number, message: string) =>
      reply({ jsonrpc: "2.0", id, error: { code, message } });
    if (method === "initialize")
      return result({
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "mogplex-research", version: "1.0.0" },
        instructions: WEB_RESEARCH_INSTRUCTIONS,
      });
    if (method === "ping") return result({});
    if (method === "tools/list")
      return result({
        tools: await Promise.all(
          Object.entries(tools)
            .filter(([, entry]) =>
              hasCapability(capabilities, entry.capability)
            )
            .map(async ([name, entry]) => ({
              name,
              description: entry.tool.description,
              inputSchema: await asSchema(entry.tool.inputSchema).jsonSchema,
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                openWorldHint: true,
              },
            }))
        ),
      });
    if (method !== "tools/call") return error(-32601, "Method not found");
    const name = params?.name;
    if (name !== "web_search" && name !== "web_fetch")
      return error(-32602, "Unknown tool");
    const entry = tools[name];
    if (!hasCapability(capabilities, entry.capability))
      return error(-32003, "Tool not permitted");
    const input = entry.schema.safeParse(params?.arguments);
    if (!input.success) return error(-32602, "Invalid tool arguments");
    try {
      const output = await entry.tool.execute!(input.data, {
        toolCallId: String(id),
        messages: [],
        context: {},
        abortSignal: request.signal,
      });
      return result({
        content: [{ type: "text", text: JSON.stringify(output) }],
        isError: Boolean(
          output && typeof output === "object" && "error" in output
        ),
      });
    } catch {
      return result({
        content: [
          {
            type: "text",
            text: "Research request failed or targeted an unsafe URL.",
          },
        ],
        isError: true,
      });
    }
  };
}
