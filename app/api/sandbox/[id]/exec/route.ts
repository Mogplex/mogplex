import { NextResponse } from "next/server";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getSandboxServiceCredentials,
  isSandboxCapabilityDeniedError,
} from "@/lib/sandbox/get-user-credentials";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { getSandbox } from "@/lib/sandbox/client";
import { renewSandboxActivityLease } from "@/lib/sandbox/activity-lease";
import { touchSandboxLastActive } from "@/lib/sandbox/records";
import {
  acquireSandboxExecLock,
  buildLimitResponse,
  buildSandboxExecConcurrencyDecision,
  enforceSandboxExecLimits,
  recordLimitDecision,
  releaseSandboxExecLock,
} from "@/lib/request-limits";
import { buildRuntimeSandboxEnv } from "@/lib/repo-settings";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import { HARNESSES } from "@/lib/harness/config";
import {
  installHarnessPackage,
  isHarnessInstalled,
} from "@/lib/harness/install";
import { resolveSandboxAiAccess } from "@/lib/sandbox/ai-runtime";
import { resolveSandboxRecordContext } from "@/lib/sandbox/context";
import {
  createSandboxBillingOnResume,
  sandboxBillingAdmissionHttpStatus,
} from "@/lib/billing/sandbox-usage";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import { detectInteractiveInvocation } from "@/lib/sandbox/interactive-guard";
import { startExecStream } from "@/lib/sandbox/exec-stream";
import { syncTerminalRuntimeAuth } from "@/lib/sandbox/dev-tools";
import {
  TERMINAL_EXEC_MODE_HEADER,
  TERMINAL_EXEC_MODE_IMMEDIATE,
} from "@/lib/sandbox/terminal-exec-response";
import type { HarnessId } from "@/lib/harness/config";
import type { Sandbox } from "@vercel/sandbox";

function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

function buildImmediateExecHeaders(headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(TERMINAL_EXEC_MODE_HEADER, TERMINAL_EXEC_MODE_IMMEDIATE);
  return nextHeaders;
}

function immediateExecJson(body: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: buildImmediateExecHeaders(init?.headers),
  });
}

const REMOTE_GIT_COMMANDS = new Set([
  "clone",
  "fetch",
  "pull",
  "push",
  "ls-remote",
]);

function commandMayNeedGithubAuth(command: string) {
  // Best-effort optimization for ordinary terminal commands. Agent delivery
  // preparation starts with an explicit remote git operation, while unusual
  // wrappers such as `sh -c` may need the user to retry without the wrapper if
  // their cached credential has expired.
  const tokens = command
    .split(/\s+/)
    .map((token) => token.replace(/^[;&|()]+|[;&|()]+$/g, ""));

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "gh") return true;
    if (
      tokens[index] === "git" &&
      tokens.slice(index + 1).some((token) => REMOTE_GIT_COMMANDS.has(token))
    ) {
      return true;
    }
  }
  return false;
}

/** Map of CLI binary name → harness ID for auto-install detection. */
const BINARY_TO_HARNESS: Record<string, HarnessId> = {
  claude: "claude-code",
  codex: "codex",
};

/**
 * If the command starts with a harness binary (claude, codex),
 * ensure it's installed in the sandbox before executing.
 */
async function ensureHarnessInstalled(
  sandbox: Sandbox,
  command: string
): Promise<string | null> {
  const firstWord = command.split(/\s/)[0];
  const harnessId = BINARY_TO_HARNESS[firstWord];
  if (!harnessId) return null;

  if (await isHarnessInstalled(sandbox, harnessId)) {
    return null;
  }

  try {
    await installHarnessPackage(sandbox, harnessId);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : `Failed to install ${HARNESSES[harnessId].package}`;
  }
}

type ExecSandboxRecord = {
  sandbox_id: string;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  preview_url: string | null;
  repo:
    | {
        root_directory?: string | null;
        sandbox_env_vars?: unknown;
        env_sync_mode?: unknown;
        vercel_project_id?: string | null;
        vercel_team_id?: string | null;
        github_installation_id?: number | null;
      }
    | Array<{
        root_directory?: string | null;
        sandbox_env_vars?: unknown;
        env_sync_mode?: unknown;
        vercel_project_id?: string | null;
        vercel_team_id?: string | null;
        github_installation_id?: number | null;
      }>
    | null;
};

type SandboxExecPostDeps = {
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  loadOwnedSandboxRecord: (
    sandboxId: string,
    userId: string
  ) => Promise<ExecSandboxRecord | null>;
  enforceSandboxExecLimits: typeof enforceSandboxExecLimits;
  acquireSandboxExecLock: typeof acquireSandboxExecLock;
  recordLimitDecision: typeof recordLimitDecision;
  releaseSandboxExecLock: typeof releaseSandboxExecLock;
  getSandbox: typeof getSandbox;
  resolveSandboxAiAccess: typeof resolveSandboxAiAccess;
  getGithubAccessTokenForRepo: typeof getGithubAccessTokenForRepo;
  syncTerminalRuntimeAuth: typeof syncTerminalRuntimeAuth;
  touchSandboxLastActive: typeof touchSandboxLastActive;
  renewSandboxActivityLease: typeof renewSandboxActivityLease;
};

const defaultSandboxExecPostDeps: SandboxExecPostDeps = {
  getSandboxServiceCredentials,
  async loadOwnedSandboxRecord(sandboxId, userId) {
    const { data } = await supabaseAdmin
      .from("sandboxes")
      .select(
        "sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)"
      )
      .eq("id", sandboxId)
      .eq("user_id", userId)
      .single();

    return (data as ExecSandboxRecord | null) ?? null;
  },
  enforceSandboxExecLimits,
  acquireSandboxExecLock,
  recordLimitDecision,
  releaseSandboxExecLock,
  getSandbox,
  resolveSandboxAiAccess,
  getGithubAccessTokenForRepo,
  syncTerminalRuntimeAuth,
  touchSandboxLastActive,
  renewSandboxActivityLease,
};

export function createSandboxExecPostHandler(
  overrides: Partial<SandboxExecPostDeps> = {}
) {
  const deps: SandboxExecPostDeps = {
    ...defaultSandboxExecPostDeps,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    let creds: Awaited<ReturnType<typeof deps.getSandboxServiceCredentials>>;
    try {
      creds = await deps.getSandboxServiceCredentials(request, {
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

    const { command, args, cwd } = await request.json();
    if (!command)
      return NextResponse.json({ error: "command required" }, { status: 400 });

    const sandboxData = await loadOwnedSandboxRouteContext<ExecSandboxRecord>(
      request,
      id,
      {
        select:
          "sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)",
        includeAi: true,
        hydrateSandboxClient: false,
      },
      {
        getSandboxServiceCredentials: async () => creds,
        loadOwnedSandboxRecord: async (sandboxId, userId) =>
          deps.loadOwnedSandboxRecord(sandboxId, userId),
        getSandbox: deps.getSandbox,
        resolveSandboxRecordContext: (input) =>
          resolveSandboxRecordContext(input, {
            resolveSandboxAiAccess: deps.resolveSandboxAiAccess,
          }),
      }
    );
    if (!sandboxData.ok) {
      return buildSandboxRouteErrorResponse(sandboxData);
    }
    if (sandboxData.record.sandbox_id === "pending") {
      return NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      );
    }

    const execLock = await deps.acquireSandboxExecLock(id);
    if (!execLock.acquired) {
      const concurrencyDecision = buildSandboxExecConcurrencyDecision();
      await deps.recordLimitDecision({
        userId: creds.userId,
        routeKey: "sandbox_exec",
        decision: concurrencyDecision,
        sandboxId: id,
        resourceId: id,
      });
      return buildLimitResponse(concurrencyDecision);
    }

    const execLockToken = execLock.token;
    let lockReleaseHandedOff = false;

    try {
      const limitDecision = await deps.enforceSandboxExecLimits({
        userId: creds.userId,
        sandboxId: id,
      });
      if (!limitDecision.allowed) {
        return buildLimitResponse(limitDecision);
      }

      const { context, repo } = sandboxData;
      if (!("ai" in context)) {
        return NextResponse.json(
          { error: "Sandbox AI context unavailable" },
          { status: 500 }
        );
      }

      const sandbox = await deps.getSandbox(
        sandboxData.record.sandbox_id,
        {
          vercelToken: context.credentials.vercelToken,
          vercelTeamId: context.credentials.vercelTeamId,
          vercelProjectId: context.credentials.vercelProjectId,
        },
        { onResume: createSandboxBillingOnResume(id) }
      );
      await deps.renewSandboxActivityLease(sandbox);

      const repoRootDirectory = sandboxData.rootDirectory;
      const envResolution = await resolveRepoSandboxEnv({
        repo: repo ?? {},
        userId: creds.userId,
      });
      const envVars = buildRuntimeSandboxEnv(
        envResolution.envVars,
        envResolution.sync.mode,
        sandboxData.record.preview_url
      );

      // Shared bash history across terminal panes within the same sandbox
      if (!envVars.HISTFILE) envVars.HISTFILE = "/tmp/.mogplex_bash_history";

      const commandCwd =
        typeof cwd === "string" && cwd.trim()
          ? cwd
          : repoRootDirectory || undefined;

      const trimmed = String(command).trim();
      const repoRecord = Array.isArray(sandboxData.record.repo)
        ? sandboxData.record.repo[0]
        : sandboxData.record.repo;
      if (
        commandMayNeedGithubAuth(trimmed) &&
        repoRecord?.github_installation_id
      ) {
        try {
          const githubToken = await deps.getGithubAccessTokenForRepo({
            user_id: creds.userId,
            github_installation_id: repoRecord.github_installation_id,
          });
          if (githubToken) {
            envVars.GITHUB_TOKEN = githubToken;
            envVars.GH_TOKEN = githubToken;
            const authSync = await deps.syncTerminalRuntimeAuth(sandbox, {
              githubToken,
            });
            if (!authSync.ok) {
              console.warn("[sandbox/exec] GitHub auth refresh failed", {
                sandboxId: id,
                error: authSync.error,
              });
            }
          }
        } catch (error) {
          console.warn("[sandbox/exec] GitHub token refresh failed", {
            sandboxId: id,
            error,
          });
        }
      }
      const harnessId = BINARY_TO_HARNESS[trimmed.split(/\s/)[0]];
      Object.assign(envVars, context.ai.terminalEnv);
      if (harnessId) {
        const harnessAiEnv = context.ai.buildHarnessEnv(harnessId);
        if (!harnessAiEnv.ok) {
          return NextResponse.json(
            { error: harnessAiEnv.error },
            { status: 401 }
          );
        }
        Object.assign(envVars, harnessAiEnv.env, {
          MOGPLEX_AI_BILLING_SOURCE: harnessAiEnv.aiBillingSource,
        });
      } else if (context.ai.aiBillingSource) {
        envVars.MOGPLEX_AI_BILLING_SOURCE = context.ai.aiBillingSource;
      }
      const cdMatch = /^cd(?:\s+(.+))?$/.exec(trimmed);

      if (cdMatch) {
        const cdTarget = (cdMatch[1] || ".").trim();
        const cdResult = await sandbox.runCommand({
          cmd: "sh",
          args: ["-lc", `cd '${escapeShell(cdTarget)}' && pwd`],
          cwd: commandCwd,
          env: envVars,
        });
        const [stdout, stderr] = await Promise.all([
          cdResult.stdout(),
          cdResult.stderr(),
        ]);

        if (cdResult.exitCode === 0) {
          const nextCwd =
            stdout.trim() || commandCwd || repoRootDirectory || ".";
          try {
            await deps.touchSandboxLastActive(id);
          } catch (error) {
            console.warn(
              "[sandbox/exec] failed to touch sandbox last_active_at",
              { sandboxId: id, error }
            );
          }

          return immediateExecJson({
            exitCode: 0,
            stdout: "",
            stderr: "",
            cwd: nextCwd,
          });
        }

        return immediateExecJson({
          exitCode: cdResult.exitCode,
          stdout,
          stderr,
          cwd: commandCwd || repoRootDirectory || ".",
        });
      }

      const interactive = detectInteractiveInvocation(trimmed);
      if (interactive) {
        return immediateExecJson({
          exitCode: 1,
          stdout: "",
          stderr: interactive.message,
          cwd: commandCwd || repoRootDirectory || ".",
        });
      }

      // Auto-install harness CLIs (claude, codex) on first use
      const installError = await ensureHarnessInstalled(sandbox, trimmed);
      if (installError) {
        return immediateExecJson({
          exitCode: 1,
          stdout: "",
          stderr: installError,
          cwd: commandCwd || repoRootDirectory || ".",
        });
      }

      const wantsStream = request.headers
        .get("accept")
        ?.includes("text/event-stream");

      if (wantsStream) {
        const sandboxId = id;
        const releaseLock = deps.releaseSandboxExecLock;
        const touchActive = deps.touchSandboxLastActive;
        lockReleaseHandedOff = true;
        return await startExecStream({
          sandbox,
          run: args
            ? { kind: "raw", cmd: trimmed, args }
            : { kind: "shell", command: trimmed },
          cwd: commandCwd,
          env: envVars,
          reportedCwd: commandCwd || repoRootDirectory || ".",
          onActivity: async () => {
            await deps.renewSandboxActivityLease(sandbox);
          },
          onComplete: async () => {
            try {
              await releaseLock(sandboxId, execLockToken);
            } catch (error) {
              console.warn("[sandbox/exec] failed to release exec lock", {
                sandboxId,
                error,
              });
            }
            try {
              await touchActive(sandboxId);
            } catch (error) {
              console.warn(
                "[sandbox/exec] failed to touch sandbox last_active_at",
                { sandboxId, error }
              );
            }
          },
        });
      }

      const result = args
        ? await sandbox.runCommand({
            cmd: trimmed,
            args,
            cwd: commandCwd,
            env: envVars,
          })
        : await sandbox.runCommand({
            cmd: "sh",
            args: ["-lc", trimmed],
            cwd: commandCwd,
            env: envVars,
          });

      const [stdout, stderr] = await Promise.all([
        result.stdout(),
        result.stderr(),
      ]);

      try {
        await deps.touchSandboxLastActive(id);
      } catch (error) {
        console.warn("[sandbox/exec] failed to touch sandbox last_active_at", {
          sandboxId: id,
          error,
        });
      }

      return immediateExecJson({
        exitCode: result.exitCode,
        stdout,
        stderr,
        cwd: commandCwd || repoRootDirectory || ".",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Execution failed";
      return NextResponse.json(
        { error: message },
        { status: sandboxBillingAdmissionHttpStatus(err) ?? 500 }
      );
    } finally {
      if (!lockReleaseHandedOff) {
        try {
          await deps.releaseSandboxExecLock(id, execLockToken);
        } catch (error) {
          console.warn("[sandbox/exec] failed to release exec lock", {
            sandboxId: id,
            error,
          });
        }
      }
    }
  };
}

export const POST = createSandboxExecPostHandler();
