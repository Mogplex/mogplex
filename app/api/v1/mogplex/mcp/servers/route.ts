import { resolveApiKey } from "@/lib/auth/api-key";
import { listMogplexApiMcpServers } from "@/lib/mogplex-api/mcp-servers";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import type { NextRequest } from "next/server";

type MogplexApiMcpServersGetDeps = {
  resolveApiKey: typeof resolveApiKey;
  listServers: typeof listMogplexApiMcpServers;
};

const defaultMogplexApiMcpServersGetDeps: MogplexApiMcpServersGetDeps = {
  resolveApiKey,
  listServers: listMogplexApiMcpServers,
};

export function createMogplexApiMcpServersGetHandler(
  overrides: Partial<MogplexApiMcpServersGetDeps> = {}
) {
  const deps: MogplexApiMcpServersGetDeps = {
    ...defaultMogplexApiMcpServersGetDeps,
    ...overrides,
  };

  return async function GET(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: deps.resolveApiKey,
    });
    if (!user.ok) return user.response;

    // MCP configs surface auth headers and vault-decrypted env vars, so gate
    // the listing on the `read` scope rather than presence of any valid PAT.
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;

    try {
      const servers = await deps.listServers(user.userId);
      return mogplexApiSuccess({ servers });
    } catch (error) {
      console.error(
        "[mogplex-api/mcp/servers] failed to list mcp servers",
        error
      );
      return mogplexApiError(
        "INTERNAL_ERROR",
        "Failed to list MCP servers",
        500
      );
    }
  };
}

export const GET = createMogplexApiMcpServersGetHandler();
