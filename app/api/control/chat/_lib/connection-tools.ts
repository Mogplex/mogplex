import { guardControlBackgroundTools } from "@/lib/control/background-context";
import { gateConnectionTools } from "@/lib/agents/orchestrator/connection-approval";
import { serializeSandboxCommandTools } from "@/lib/agents/orchestrator/serialized-commands";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorTools,
  wrapToolsWithPolicy,
  type OrchestratorToolContext,
} from "@/lib/agents/orchestrator";
import {
  buildDynamicConnectionTools,
  canUseConnectionTools,
  cleanupMcpClients,
  loadScopedConnections,
} from "@/lib/agents/tools/connections";
import {
  ALL_CAPABILITIES,
  resolveMemberCapabilities,
  type Capability,
} from "@/lib/team-capabilities";
import type { Connection } from "@/lib/types";
import type { Tool } from "ai";

/**
 * How long a Control turn waits for connection tools. Remote MCP servers are
 * someone else's uptime: a slow one must cost the turn its connection tools,
 * never the turn itself. Same posture as the memory block: fail open.
 */
export const CONTROL_CONNECTION_TOOLS_TIMEOUT_MS = 8000;

export type ControlConnectionTools = {
  tools: Record<string, Tool>;
  connections: Connection[];
  /** Tools of connections set to `ask`; each call waits for the operator. */
  askToolNames: ReadonlySet<string>;
  /** Closes the MCP clients these tools hold. Safe to call more than once. */
  cleanup: () => Promise<void>;
};

const NO_CONNECTION_TOOLS: ControlConnectionTools = {
  tools: {},
  connections: [],
  askToolNames: new Set<string>(),
  cleanup: async () => undefined,
};

type BuiltConnectionTools = Awaited<
  ReturnType<typeof buildDynamicConnectionTools>
>;

export type ControlConnectionToolDeps = {
  resolveCapabilities: (
    userId: string,
    teamId: string
  ) => Promise<ReadonlySet<Capability>>;
  loadConnections: (
    userId: string,
    repoId: string | undefined
  ) => Promise<Connection[]>;
  buildTools: (
    connections: Connection[],
    ctx: { userId: string; repoId?: string; canAskApproval: boolean }
  ) => Promise<BuiltConnectionTools>;
  timeoutMs: number;
};

const DEFAULT_DEPS: ControlConnectionToolDeps = {
  resolveCapabilities: resolveMemberCapabilities,
  loadConnections: loadScopedConnections,
  buildTools: buildDynamicConnectionTools,
  timeoutMs: CONTROL_CONNECTION_TOOLS_TIMEOUT_MS,
};

const TIMED_OUT = Symbol("control-connection-tools-timeout");

/**
 * The operator's connection tools for one Control turn: every enabled
 * connection in scope, under the same `connections.create` capability the
 * workspace chat applies. Never throws.
 */
export async function loadControlConnectionTools(
  input: {
    userId: string;
    teamId: string | null;
    repoId?: string | null;
    enabled: boolean;
  },
  deps: ControlConnectionToolDeps = DEFAULT_DEPS
): Promise<ControlConnectionTools> {
  if (!input.enabled) return NO_CONNECTION_TOOLS;
  const repoId = input.repoId ?? undefined;

  try {
    const capabilities = input.teamId
      ? await deps.resolveCapabilities(input.userId, input.teamId)
      : ALL_CAPABILITIES;
    if (!canUseConnectionTools(capabilities, input.teamId, [])) {
      return NO_CONNECTION_TOOLS;
    }

    const connections = await deps.loadConnections(input.userId, repoId);
    if (connections.length === 0) return NO_CONNECTION_TOOLS;

    const building = deps.buildTools(connections, {
      userId: input.userId,
      repoId,
      // Control can put an approval card in front of a call, so it loads
      // connections set to `ask` instead of withholding them.
      canAskApproval: true,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), deps.timeoutMs);
    });
    const built = await Promise.race([building, timeout]);
    clearTimeout(timer);

    if (built === TIMED_OUT) {
      console.warn("[control] connection tools timed out; turn continues", {
        userId: input.userId,
        connectionCount: connections.length,
      });
      // The build may still finish: close whatever it opened.
      void building
        .then((late) => cleanupMcpClients(late.mcpCleanups))
        .catch(() => undefined);
      return NO_CONNECTION_TOOLS;
    }

    return {
      tools: built.dynamicTools,
      connections,
      askToolNames: built.askToolNames,
      cleanup: () => cleanupMcpClients(built.mcpCleanups),
    };
  } catch (error) {
    console.warn("[control] connection tools failed to load; turn continues", {
      userId: input.userId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return NO_CONNECTION_TOOLS;
  }
}

/**
 * The turn's callable tools and the prompt that describes them. Connection
 * tools join the registry's; a registry name always wins, so a connection can
 * never shadow a Control tool such as `memory_write`.
 */
export function buildControlTurnTools(input: {
  toolContext: OrchestratorToolContext;
  promptContext: Parameters<typeof buildOrchestratorSystemPrompt>[0];
  connectionTools: ControlConnectionTools;
  enableTools: boolean;
  assertCurrent?: () => Promise<void>;
}) {
  const registryTools = buildOrchestratorTools(input.toolContext);
  const shadowed = Object.keys(input.connectionTools.tools).filter(
    (name) => name in registryTools
  );
  if (shadowed.length > 0) {
    console.warn("[control] connection tools shadowed by registry tools", {
      userId: input.toolContext.userId,
      shadowed,
    });
  }
  const rawTools = {
    ...gateConnectionTools(
      input.connectionTools.tools,
      input.connectionTools.askToolNames,
      input.toolContext
    ),
    ...registryTools,
  };

  const tools = input.enableTools
    ? serializeSandboxCommandTools(
        guardControlBackgroundTools(
          wrapToolsWithPolicy(rawTools, input.toolContext),
          input.assertCurrent
        )
      )
    : undefined;

  const systemPrompt = buildOrchestratorSystemPrompt({
    ...input.promptContext,
    availableToolNames: input.enableTools ? Object.keys(rawTools) : [],
    connections: input.enableTools ? input.connectionTools.connections : [],
    connectionsCanAskApproval: true,
  });

  return { tools, systemPrompt };
}
