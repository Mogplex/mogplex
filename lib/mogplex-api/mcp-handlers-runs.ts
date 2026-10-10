import { randomUUID } from "node:crypto";
import {
  runArtifactArgsSchema,
  runEventsArgsSchema,
  runIdArgsSchema,
  startAgentRunArgsSchema,
} from "./mcp-schemas";
import { parseArgs, textResult } from "./mcp-tool-result";
import type { McpToolResult, MogplexMcpContext } from "./mcp-types";

/**
 * One-off agent run tools. Returns null for any other tool name, so the
 * caller can report it as unknown. Errors propagate to the caller, which owns
 * turning them into tool results.
 */
export async function callMogplexRunTool(
  name: string,
  args: Record<string, unknown> | undefined,
  context: MogplexMcpContext
): Promise<McpToolResult | null> {
  switch (name) {
    case "mogplex_start_agent_run": {
      const input = parseArgs(startAgentRunArgsSchema, args);
      const result = await context.client.startAgentRun({
        ...input,
        idempotencyKey: input.idempotencyKey ?? `mcp:${randomUUID()}`,
      });
      return textResult(
        `Started Mogplex run ${result.runId} on branch ${result.branch.working}. Status: ${result.status}.`,
        { run: result }
      );
    }
    case "mogplex_get_run": {
      const input = parseArgs(runIdArgsSchema, args);
      const result = await context.client.getRun(input);
      return textResult(
        `Mogplex run ${result.run.runId} is ${result.run.status} on branch ${result.run.branch.working}.`,
        result
      );
    }
    case "mogplex_get_run_events": {
      const input = parseArgs(runEventsArgsSchema, args);
      const result = await context.client.getRunEvents(input);
      const latest = result.events.at(-1);
      const latestLabel = latest?.message ?? latest?.type ?? "none";
      return textResult(
        `Found ${result.events.length} events for Mogplex run ${result.run.runId}. Latest: ${latestLabel}.`,
        result
      );
    }
    case "mogplex_cancel_run": {
      const input = parseArgs(runIdArgsSchema, args);
      const result = await context.client.cancelRun(input);
      return textResult(
        `Cancellation requested for Mogplex run ${result.run.runId}. Status: ${result.status}.`,
        result
      );
    }
    case "mogplex_get_run_artifact": {
      const input = parseArgs(runArtifactArgsSchema, args);
      const result = await context.client.getRunArtifact(input);
      const pinnedLabel = result.artifact.pinned
        ? " (pinned)"
        : " (branch tip)";
      return textResult(
        `Loaded artifact ${result.artifact.path} from run ${result.artifact.runId} at commit ${result.artifact.commitSha.slice(0, 7)}${pinnedLabel}.`,
        result
      );
    }
    default:
      return null;
  }
}
