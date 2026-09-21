import { getConnectionPreset } from "./presets";
import { createTriggerApiTools } from "./trigger-api/tools";
import type { ConnectionPreset } from "./presets";
import type { Connection } from "@/lib/types";
import type { Tool } from "ai";

type ApiToolsetId = NonNullable<ConnectionPreset["api_toolset"]>;

type ApiToolsetBuilder = (credential: string) => Record<string, Tool>;

const API_TOOLSET_BUILDERS: Record<ApiToolsetId, ApiToolsetBuilder> = {
  trigger: (credential) => createTriggerApiTools(credential),
};

/**
 * The server-side toolset a connection's preset declares, or null. These tools
 * call the provider's REST API with the saved credential, so they work in turns
 * that have no sandbox to launch an MCP server in.
 */
export function getConnectionApiToolset(
  conn: Pick<Connection, "source_preset">
): ApiToolsetBuilder | null {
  const toolsetId = getConnectionPreset(conn.source_preset)?.api_toolset;
  return toolsetId ? API_TOOLSET_BUILDERS[toolsetId] : null;
}

/** How many tools the connection's API toolset exposes; null when it has none. */
export function countConnectionApiTools(
  conn: Pick<Connection, "source_preset">
): number | null {
  const build = getConnectionApiToolset(conn);
  // Building is pure: no request leaves until a tool executes.
  return build ? Object.keys(build("")).length : null;
}
