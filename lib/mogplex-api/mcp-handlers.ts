import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MogplexApiClientError } from "./client";
import {
  McpToolArgumentError,
  type McpToolResult,
  type MogplexMcpContext,
} from "./mcp-types";
import {
  automationIdArgsSchema,
  automationRunLogsArgsSchema,
  automationRunsArgsSchema,
  createAutomationArgsSchema,
  createSandboxArgsSchema,
  deleteEnvVarArgsSchema,
  listAutomationsArgsSchema,
  listReposArgsSchema,
  listSandboxesArgsSchema,
  repoIdArgsSchema,
  runEventsArgsSchema,
  runIdArgsSchema,
  sandboxIdArgsSchema,
  setAutomationModelArgsSchema,
  setEnvVarArgsSchema,
  startAgentRunArgsSchema,
  triggerAutomationArgsSchema,
  updateAutomationArgsSchema,
} from "./mcp-schemas";

export function parseArgs<T extends z.ZodTypeAny>(
  schema: T,
  args: Record<string, unknown> | undefined
): z.infer<T> {
  const result = schema.safeParse(args ?? {});
  if (result.success) return result.data;

  throw new McpToolArgumentError(
    result.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`
      )
      .join("; ")
  );
}

export function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  isError = false
): McpToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError ? { isError: true } : { isError: false }),
  };
}

function getMogplexApiErrorSuggestion(error: MogplexApiClientError) {
  switch (error.code) {
    case "UNAUTHORIZED":
      return "Check the Mogplex API token used for this MCP server.";
    case "NOT_FOUND":
      return "List repos or runs again and pass an id owned by this token.";
    case "IDEMPOTENCY_CONFLICT":
      return "Retry with a new idempotency key or reuse the original request.";
    case "BAD_REQUEST":
      return "Check the tool arguments and retry.";
    case "CONFLICT":
      return "Refresh the run state; it may no longer be active.";
    default:
      return "Retry later or inspect Mogplex API logs for this request.";
  }
}

export function errorToolResult(error: unknown): McpToolResult {
  if (error instanceof MogplexApiClientError) {
    const suggestion = getMogplexApiErrorSuggestion(error);
    return textResult(
      `${error.message}. ${suggestion}`,
      {
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          suggestion,
        },
      },
      true
    );
  }

  const message =
    error instanceof Error ? error.message : "Mogplex MCP tool failed";
  return textResult(
    `${message}. Retry later or inspect Mogplex API logs for this request.`,
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    true
  );
}

export async function callMogplexTool(
  name: string,
  args: Record<string, unknown> | undefined,
  context: MogplexMcpContext
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "mogplex_list_repos": {
        const input = parseArgs(listReposArgsSchema, args);
        const result = await context.client.listRepos(input);
        return textResult(
          `Found ${result.repos.length} Mogplex repos.`,
          result
        );
      }
      case "mogplex_list_env_vars": {
        const input = parseArgs(repoIdArgsSchema, args);
        const result = await context.client.listRepoEnvVars(input);
        return textResult(
          `Found ${result.envVars.length} env vars on the linked Vercel project. Values are not returned.`,
          result
        );
      }
      case "mogplex_set_env_var": {
        const input = parseArgs(setEnvVarArgsSchema, args);
        const result = await context.client.upsertRepoEnvVar(input);
        return textResult(
          result.action === "created"
            ? `Created env var ${result.key} on the linked Vercel project.`
            : `Updated ${result.updatedCount} ${result.key} env var ${result.updatedCount === 1 ? "entry" : "entries"} on the linked Vercel project.`,
          result
        );
      }
      case "mogplex_delete_env_var": {
        const input = parseArgs(deleteEnvVarArgsSchema, args);
        const result = await context.client.deleteRepoEnvVar(input);
        return textResult(
          `Deleted ${result.deletedCount} ${result.key} env var ${result.deletedCount === 1 ? "entry" : "entries"} from the linked Vercel project.`,
          result
        );
      }
      case "mogplex_list_agents": {
        parseArgs(z.object({}).strict(), args);
        const result = await context.client.listAgents();
        return textResult(
          `Found ${result.agents.length} Mogplex agents.`,
          result
        );
      }
      case "mogplex_list_models": {
        parseArgs(z.object({}).strict(), args);
        const result = await context.client.listModels();
        return textResult(
          `Found ${result.models.length} enabled Mogplex models.`,
          result
        );
      }
      case "mogplex_list_sandboxes": {
        const input = parseArgs(listSandboxesArgsSchema, args);
        const result = await context.client.listSandboxes(input);
        return textResult(
          `Found ${result.sandboxes.length} Mogplex sandboxes.`,
          result
        );
      }
      case "mogplex_create_sandbox": {
        const input = parseArgs(createSandboxArgsSchema, args);
        const result = await context.client.createSandbox(input);
        return textResult(
          `Mogplex sandbox ${result.sandbox.id} is ${result.sandbox.status} on branch ${result.sandbox.working_branch}.`,
          result
        );
      }
      case "mogplex_get_sandbox_logs": {
        const input = parseArgs(sandboxIdArgsSchema, args);
        const result = await context.client.getSandboxLogs(input);
        return textResult(
          `Loaded sandbox logs and ${result.lifecycle_events.length} lifecycle events for ${result.sandbox.id}.`,
          result
        );
      }
      case "mogplex_list_automations": {
        const input = parseArgs(listAutomationsArgsSchema, args);
        const result = await context.client.listAutomations(input);
        return textResult(
          `Found ${result.automations.length} Mogplex automation summaries.${result.nextCursor ? " More are available with nextCursor." : ""}`,
          result
        );
      }
      case "mogplex_get_automation": {
        const input = parseArgs(automationIdArgsSchema, args);
        const result = await context.client.getAutomation(input);
        return textResult(
          `Mogplex automation ${result.automation.name} is ${result.automation.status}.`,
          result
        );
      }
      case "mogplex_create_automation": {
        const input = parseArgs(createAutomationArgsSchema, args);
        const result = await context.client.createAutomation(input);
        return textResult(
          `Created Mogplex automation ${result.automation.id} (${result.automation.name}). Status: ${result.automation.status}.`,
          result
        );
      }
      case "mogplex_update_automation": {
        const input = parseArgs(updateAutomationArgsSchema, args);
        const result = await context.client.updateAutomation(input);
        return textResult(
          `Updated draft for Mogplex automation ${result.automation.id}.`,
          result
        );
      }
      case "mogplex_publish_automation": {
        const input = parseArgs(automationIdArgsSchema, args);
        const result = await context.client.publishAutomation(input);
        return textResult(
          `Published and activated Mogplex automation ${result.automation.id}.`,
          result
        );
      }
      case "mogplex_set_automation_model": {
        const input = parseArgs(setAutomationModelArgsSchema, args);
        const result = await context.client.setAutomationModel(input);
        const published = input.publish ? " and published it" : "";
        return textResult(
          `Updated model for node ${input.nodeId} in automation ${result.automation.id}${published}.`,
          result
        );
      }
      case "mogplex_trigger_automation": {
        const input = parseArgs(triggerAutomationArgsSchema, args);
        const result = await context.client.triggerAutomation({
          ...input,
          idempotencyKey: input.idempotencyKey ?? `mcp:${randomUUID()}`,
        });
        return textResult(
          `Automation ${result.run.automationId} trigger outcome: ${result.run.outcome}. Job run: ${result.run.jobRunId ?? "none"}.`,
          result
        );
      }
      case "mogplex_list_automation_runs": {
        const input = parseArgs(automationRunsArgsSchema, args);
        const result = await context.client.listAutomationRuns(input);
        return textResult(
          `Found ${result.runs.length} runs for automation ${input.automationId}.`,
          result
        );
      }
      case "mogplex_get_automation_run_logs": {
        const input = parseArgs(automationRunLogsArgsSchema, args);
        const result = await context.client.getAutomationRunLogs(input);
        return textResult(
          `Loaded logs for automation run ${result.run.id}. Status: ${result.run.status}.`,
          result
        );
      }
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
      default:
        throw new McpToolArgumentError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpToolArgumentError) throw error;
    return errorToolResult(error);
  }
}
