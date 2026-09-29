import { z } from "zod";
import { asSchema, type Tool } from "ai";
import { WEB_RESEARCH_INSTRUCTIONS } from "@/lib/agents/web-research-instructions";
import type { Capability } from "@/lib/team-capabilities";
import { verifyResearchToken, type ResearchClaims } from "./research-auth";
import { buildHarnessMogplexTools, type HarnessToolRun } from "./mogplex-tools";
import { MOGPLEX_READ_ONLY_TOOLS } from "./mogplex-tool-names";
import { createToolBuildCache } from "./mogplex-tool-cache";
import { redactSecretsInText } from "@/lib/ai-telemetry";

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

// Tool arguments carry pull request bodies and memories, not just queries.
const MAX_REQUEST_CHARS = 1_000_000;

const INSTRUCTIONS = `${WEB_RESEARCH_INSTRUCTIONS}
<mogplex-tools>
These are the Mogplex agent's own tools for this run: web research, the user's memories and skills, GitHub, and connections that run on Mogplex's servers. Search memories and skills before work that may have an established answer or procedure.
</mogplex-tools>`;

type BuiltTools = { tools: Record<string, Tool>; cleanup: () => Promise<void> };

export type MogplexMcpDeps = {
  /** Revalidate the active run and resolve its scope and team capabilities. */
  authorizeRun: (claims: ResearchClaims) => Promise<{
    run: HarnessToolRun;
    capabilities: ReadonlySet<Capability>;
  } | null>;
  buildTools?: (
    run: HarnessToolRun,
    capabilities: ReadonlySet<Capability>
  ) => Promise<BuiltTools>;
  /** How long one run's build is reused across its requests. */
  cacheTtlMs?: number;
};

const TOOL_BUILD_TTL_MS = 60_000;

/** Same run, same capabilities: the same tool set. */
function buildKey(run: HarnessToolRun, capabilities: ReadonlySet<Capability>) {
  return `${run.aiCallId}:${[...capabilities].sort().join(",")}`;
}

function logFailure(stage: string, name: string | null, error: unknown) {
  console.warn(`[mogplex-mcp] ${stage} failed`, {
    tool: name,
    error: redactSecretsInText(
      error instanceof Error ? error.message : String(error)
    ).slice(0, 500),
  });
}

async function listTools(tools: Record<string, Tool>) {
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: await asSchema(tool.inputSchema).jsonSchema,
      ...(MOGPLEX_READ_ONLY_TOOLS.has(name)
        ? { annotations: { readOnlyHint: true, destructiveHint: false } }
        : {}),
    }))
  );
}

async function callTool(
  tool: Tool,
  args: unknown,
  toolCallId: string,
  signal: AbortSignal
) {
  const schema = asSchema(tool.inputSchema);
  const input = schema.validate
    ? await schema.validate(args ?? {})
    : { success: true as const, value: args ?? {} };
  if (!input.success) return { valid: false as const };
  const output: unknown = await tool.execute!(input.value, {
    toolCallId,
    messages: [],
    context: {},
    abortSignal: signal,
  });
  return { valid: true as const, output: output ?? null };
}

/**
 * The run-scoped MCP server a sandbox harness gets as `mogplex`: the same
 * server-side tools the native Mogplex agent has, authorized per request
 * against the live harness run.
 */
export function createMogplexMcpPost(deps: MogplexMcpDeps) {
  const build = deps.buildTools ?? buildHarnessMogplexTools;
  const cache = createToolBuildCache(deps.cacheTtlMs ?? TOOL_BUILD_TTL_MS);
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const claims = verifyResearchToken(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
    );
    if (!claims) return reply({ error: "Unauthorized" }, 401);
    let authorized: Awaited<ReturnType<MogplexMcpDeps["authorizeRun"]>>;
    try {
      authorized = await deps.authorizeRun(claims);
    } catch {
      return reply({ error: "Run authorization unavailable" }, 503);
    }
    if (!authorized) return reply({ error: "Run is no longer active" }, 403);
    let payload: z.infer<typeof requestSchema>;
    try {
      const text = await request.text();
      if (text.length > MAX_REQUEST_CHARS)
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
        serverInfo: { name: "mogplex", version: "2.0.0" },
        instructions: INSTRUCTIONS,
      });
    if (method === "ping") return result({});
    if (method !== "tools/list" && method !== "tools/call")
      return error(-32601, "Method not found");

    const { run, capabilities } = authorized;
    let borrowed: Awaited<ReturnType<typeof cache.acquire>>;
    try {
      borrowed = await cache.acquire(buildKey(run, capabilities), () =>
        build(run, capabilities)
      );
    } catch (buildError) {
      logFailure("tool build", null, buildError);
      return error(-32603, "Mogplex tools are unavailable right now");
    }
    const { tools } = borrowed;
    try {
      if (method === "tools/list")
        return result({ tools: await listTools(tools) });
      const name = typeof params?.name === "string" ? params.name : "";
      const tool = Object.hasOwn(tools, name) ? tools[name] : undefined;
      if (!tool?.execute) return error(-32602, "Unknown tool");
      let called: Awaited<ReturnType<typeof callTool>>;
      try {
        called = await callTool(
          tool,
          params?.arguments,
          String(id),
          request.signal
        );
      } catch (toolError) {
        logFailure("tool call", name, toolError);
        return result({
          content: [{ type: "text", text: `${name} failed.` }],
          isError: true,
        });
      }
      if (!called.valid) return error(-32602, "Invalid tool arguments");
      const { output } = called;
      return result({
        content: [{ type: "text", text: JSON.stringify(output) }],
        isError: Boolean(
          output && typeof output === "object" && "error" in output
        ),
      });
    } finally {
      borrowed.release();
    }
  };
}
