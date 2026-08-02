import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";

type SessionControlSandboxRecord = {
  sandbox_id: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  repo?: Record<string, unknown> | Record<string, unknown>[] | null;
};

type SessionControlRequestBody = {
  action?: unknown;
  terminalSessionKey?: unknown;
};

type LoadOwnedSessionSandboxRouteContext =
  typeof loadOwnedSandboxRouteContext<SessionControlSandboxRecord>;

type TerminalSessionPostHandlerDeps = {
  loadOwnedSandboxRouteContext: LoadOwnedSessionSandboxRouteContext;
};

const SESSION_CONTROL_SELECT =
  "sandbox_id, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(id)";
const DEFAULT_TERMINAL_SESSION_KEY = "default";
const MAX_TERMINAL_SESSION_KEY_LENGTH = 128;

function normalizeTerminalSessionKey(value: unknown) {
  if (typeof value !== "string") return DEFAULT_TERMINAL_SESSION_KEY;
  const trimmed = value.trim();
  if (trimmed.length === 0) return DEFAULT_TERMINAL_SESSION_KEY;
  return trimmed.slice(0, MAX_TERMINAL_SESSION_KEY_LENGTH);
}

function buildTmuxSessionName(sessionKey: string) {
  return `mogplex-${createHash("sha256").update(sessionKey).digest("hex").slice(0, 24)}`;
}

export function createTerminalSessionPostHandler(
  deps?: TerminalSessionPostHandlerDeps
) {
  const resolvedDeps: TerminalSessionPostHandlerDeps = deps ?? {
    loadOwnedSandboxRouteContext,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const body = (await request
      .json()
      .catch(() => ({}))) as SessionControlRequestBody;
    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (action !== "kill") {
      return NextResponse.json(
        { error: "Unsupported action" },
        { status: 400 }
      );
    }

    const sandboxData = await resolvedDeps.loadOwnedSandboxRouteContext(
      request,
      id,
      {
        select: SESSION_CONTROL_SELECT,
        includeAi: false,
        requireCapability: "tools.bash",
      }
    );
    if (!sandboxData.ok) {
      return buildSandboxRouteErrorResponse(sandboxData);
    }
    if (!sandboxData.sandbox) {
      return NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      );
    }

    const terminalSessionKey = normalizeTerminalSessionKey(
      body.terminalSessionKey
    );
    const tmuxSessionName = buildTmuxSessionName(terminalSessionKey);

    try {
      const command = await sandboxData.sandbox.runCommand({
        cmd: "sh",
        args: [
          "-lc",
          `tmux kill-session -t '${tmuxSessionName}' 2>/dev/null || true`,
        ],
      });
      await command.stdout();
      return NextResponse.json({ ok: true, terminalSessionKey });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to control session";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const POST = createTerminalSessionPostHandler();
