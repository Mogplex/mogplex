import { createTriggerApiClient } from "./client";
import { buildTriggerTools } from "./define";
import {
  DEPLOYMENT_TOOLS,
  ENV_VAR_TOOLS,
  QUEUE_TOOLS,
} from "./tools/infrastructure";
import {
  ERROR_TOOLS,
  QUERY_TOOLS,
  SESSION_TOOLS,
  WAITPOINT_TOOLS,
} from "./tools/observability";
import { RUN_TOOLS } from "./tools/runs";
import { SCHEDULE_TOOLS } from "./tools/schedules";
import { TASK_TOOLS } from "./tools/tasks";
import type { Tool } from "ai";

const TRIGGER_TOOL_SPECS = [
  ...TASK_TOOLS,
  ...RUN_TOOLS,
  ...SCHEDULE_TOOLS,
  ...QUEUE_TOOLS,
  ...ENV_VAR_TOOLS,
  ...DEPLOYMENT_TOOLS,
  ...ERROR_TOOLS,
  ...QUERY_TOOLS,
  ...WAITPOINT_TOOLS,
  ...SESSION_TOOLS,
];

/**
 * The Trigger.dev management API as tools, read and write, backed by the saved
 * Personal Access Token and needing no sandbox. Deploys and the dev server stay
 * with the stdio MCP server because they need the repository on disk.
 */
export function createTriggerApiTools(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Record<string, Tool> {
  return buildTriggerTools(
    createTriggerApiClient(accessToken, fetchImpl),
    TRIGGER_TOOL_SPECS
  );
}
