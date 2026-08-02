import { NextResponse } from "next/server";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { buildRuntimeSandboxEnv } from "@/lib/repo-settings";
import { getSandbox } from "@/lib/sandbox/client";
import {
  getSandboxServiceCredentials,
  isSandboxCapabilityDeniedError,
} from "@/lib/sandbox/get-user-credentials";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import {
  ensureTerminalTools,
  syncTerminalRuntimeAuth,
} from "@/lib/sandbox/dev-tools";
import { resolveSandboxGitAuthor } from "@/lib/sandbox/git-author";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import { ensureTerminalBridgeInstalled } from "@/lib/sandbox/terminal-bridge-install";
import {
  isTerminalPtyEnabled,
  type TerminalPtyConnectInfo,
} from "@/lib/sandbox/terminal-pty-config";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";

type ConnectRepoRecord = {
  id?: string | null;
  root_directory?: string | null;
  sandbox_env_vars?: unknown;
  env_sync_mode?: unknown;
  vercel_project_id?: string | null;
  vercel_team_id?: string | null;
  github_installation_id?: number | null;
};

type ConnectSandboxRecord = {
  sandbox_id: string;
  status?: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  preview_url: string | null;
  repo?: ConnectRepoRecord | ConnectRepoRecord[] | null;
};

type ConnectRequestBody = {
  terminalSessionKey?: unknown;
  cwd?: unknown;
};

const CONNECT_SELECT =
  "sandbox_id, status, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(id, root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)";

const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — token is the bridge-session secret.
const DEFAULT_TERMINAL_SESSION_KEY = "default";
const MAX_TERMINAL_SESSION_KEY_LENGTH = 128;

type TerminalPtyUnavailablePayload = Extract<
  TerminalPtyConnectInfo,
  { available: false }
>;

async function loadOwnedSandboxRecord(
  sandboxId: string,
  userId: string
): Promise<ConnectSandboxRecord | null> {
  const { data } = await supabaseAdmin
    .from("sandboxes")
    .select(CONNECT_SELECT)
    .eq("id", sandboxId)
    .eq("user_id", userId)
    .single();
  return (data as ConnectSandboxRecord | null) ?? null;
}

function disabled(payload: TerminalPtyUnavailablePayload) {
  return NextResponse.json(payload);
}

function summarizeTerminalToolFailure(logs: string, fallback?: string) {
  const lines = logs
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const preferredPatterns = [
    /^(error|fatal):/i,
    /^e:/i,
    /\btmux\b.*\b(failed|unavailable|not found)\b/i,
    /\b(?:apt-get|yum|dnf|apk)\b.*\bfailed\b/i,
    /\b(command not found|not found|unavailable)\b/i,
  ];

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (preferredPatterns.some((pattern) => pattern.test(lines[index]))) {
      return lines[index];
    }
  }
  return lines.at(-1) ?? fallback;
}

function normalizeTerminalSessionKey(value: unknown) {
  if (typeof value !== "string") return DEFAULT_TERMINAL_SESSION_KEY;
  const trimmed = value.trim();
  if (trimmed.length === 0) return DEFAULT_TERMINAL_SESSION_KEY;
  return trimmed.slice(0, MAX_TERMINAL_SESSION_KEY_LENGTH);
}

function normalizeOptionalPath(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildTerminalBridgeUrl(input: {
  httpsUrl: string;
  token: string;
  terminalSessionKey: string;
  cwd?: string;
}) {
  const wsUrl = new URL("/session", input.httpsUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("token", input.token);
  wsUrl.searchParams.set("session", input.terminalSessionKey);
  if (input.cwd) {
    wsUrl.searchParams.set("cwd", input.cwd);
  }
  return wsUrl.toString();
}

async function parseConnectRequest(request: Request) {
  if (request.method !== "POST") {
    return {
      ok: true as const,
      terminalSessionKey: DEFAULT_TERMINAL_SESSION_KEY,
      cwd: undefined,
    };
  }

  let body: ConnectRequestBody;
  try {
    body = (await request.json()) as ConnectRequestBody;
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      ),
    };
  }

  return {
    ok: true as const,
    terminalSessionKey: normalizeTerminalSessionKey(body.terminalSessionKey),
    cwd: normalizeOptionalPath(body.cwd),
  };
}

async function handleConnect(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsedRequest = await parseConnectRequest(request);
  if (!parsedRequest.ok) {
    return parsedRequest.response;
  }

  const { id } = await params;
  let creds;
  try {
    creds = await getSandboxServiceCredentials(request, {
      allowInternal: true,
      teamId: readActiveTeamIdHeader(request),
      requireCapability: "tools.bash",
    });
  } catch (error) {
    if (isSandboxCapabilityDeniedError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
  if (!creds) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTerminalPtyEnabled()) {
    return disabled({ available: false, reason: "pty_disabled" });
  }

  const sandboxData = await loadOwnedSandboxRouteContext<ConnectSandboxRecord>(
    request,
    id,
    {
      select: CONNECT_SELECT,
      includeAi: true,
    },
    {
      getSandboxServiceCredentials: async () => creds,
      loadOwnedSandboxRecord,
      getSandbox,
      resolveSandboxRecordContext: (input) =>
        resolveSandboxRecordContext(input, { resolveSandboxAiAccess }),
    }
  );
  if (!sandboxData.ok) return buildSandboxRouteErrorResponse(sandboxData);
  if (!sandboxData.sandbox) {
    return disabled({ available: false, reason: "bridge_not_ready" });
  }
  if (sandboxData.record.status !== "running") {
    return disabled({ available: false, reason: "bridge_not_ready" });
  }

  const repoRecord = Array.isArray(sandboxData.repo)
    ? (sandboxData.repo[0] ?? null)
    : (sandboxData.repo ?? null);

  const envResolution = await resolveRepoSandboxEnv({
    repo: repoRecord ?? {},
    userId: creds.userId,
  });
  const terminalEnv = buildRuntimeSandboxEnv(
    envResolution.envVars,
    envResolution.sync.mode,
    sandboxData.record.preview_url
  );
  if (!terminalEnv.HISTFILE) {
    terminalEnv.HISTFILE = "/tmp/.mogplex_bash_history";
  }
  if ("ai" in sandboxData.context) {
    Object.assign(terminalEnv, sandboxData.context.ai.terminalShellEnv);
    if (sandboxData.context.ai.aiBillingSource) {
      terminalEnv.MOGPLEX_AI_BILLING_SOURCE =
        sandboxData.context.ai.aiBillingSource;
    }
  }

  let githubToken: string | null = null;
  if (repoRecord?.github_installation_id) {
    try {
      githubToken = await getGithubAccessTokenForRepo({
        user_id: creds.userId,
        github_installation_id: repoRecord.github_installation_id,
      });
    } catch (error) {
      console.warn("[terminal/connect] failed to mint github token", {
        sandboxId: id,
        error,
      });
    }
  }

  try {
    const gitAuthor = await resolveSandboxGitAuthor(creds.userId);
    const tools = await ensureTerminalTools(sandboxData.sandbox, {
      agentName: gitAuthor.name,
      agentEmail: gitAuthor.email,
    });
    if (!tools.ok) {
      // Tmux install is best-effort; the bridge runtime falls back to a plain
      // shell when tmux isn't on PATH. Only refuse connection if the
      // installer failed for a reason other than a missing tmux.
      console.warn("[terminal/connect] terminal tools failed", {
        sandboxId: id,
        error: tools.error,
        tmuxAvailable: tools.tmuxAvailable,
      });
      if (tools.tmuxAvailable !== false) {
        return disabled({
          available: false,
          reason: "tmux_unavailable",
          detail: summarizeTerminalToolFailure(
            tools.logs,
            tools.error ?? "terminal tools setup failed"
          ),
        });
      }
    }

    const authSync = await syncTerminalRuntimeAuth(sandboxData.sandbox, {
      githubToken,
    });
    if (!authSync.ok) {
      console.warn("[terminal/connect] terminal auth sync failed", {
        sandboxId: id,
        error: authSync.error,
      });
    }

    const installation = await ensureTerminalBridgeInstalled(
      sandboxData.sandbox,
      { env: terminalEnv }
    );
    const cwd = parsedRequest.cwd ?? sandboxData.rootDirectory ?? undefined;
    const payload: TerminalPtyConnectInfo = {
      available: true,
      terminalSessionKey: parsedRequest.terminalSessionKey,
      wsUrl: buildTerminalBridgeUrl({
        httpsUrl: sandboxData.sandbox.domain(installation.port),
        token: installation.token,
        terminalSessionKey: parsedRequest.terminalSessionKey,
        cwd,
      }),
      token: installation.token,
      expiresAt: installation.installedAt + DEFAULT_TOKEN_TTL_MS,
      tmuxAvailable: tools.tmuxAvailable ?? false,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.warn("[terminal/connect] bridge install failed", {
      sandboxId: id,
      error,
    });
    return disabled({
      available: false,
      reason: "bridge_install_failed",
      detail:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "terminal bridge install failed",
    });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleConnect(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleConnect(request, context);
}
