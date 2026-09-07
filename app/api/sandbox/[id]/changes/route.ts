/**
 * Live working-tree changes for a sandbox: what the agent changed, one
 * file's diff, revert, and commit/push/PR. Status, diff, and revert run
 * straight through the sandbox SDK; commit goes through the exec route so
 * GitHub credentials are injected the same way as any terminal push.
 */
import { NextResponse } from "next/server";
import type { Sandbox } from "@vercel/sandbox";
import { renewSandboxActivityLease } from "@/lib/sandbox/activity-lease";
import { touchSandboxLastActive } from "@/lib/sandbox/records";
import {
  buildSandboxRouteErrorResponse,
  loadOwnedSandboxRouteContext,
} from "@/lib/sandbox/route-context";
import {
  buildChangesStatusScript,
  buildCommitScript,
  buildFileDiffScript,
  buildRevertScript,
  isSafeRepoPath,
  parseChangesOutput,
  parseCommitOutput,
} from "@/lib/sandbox/changes";

const CHANGES_ROUTE_SELECT =
  "sandbox_id, root_directory, working_branch, base_branch, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(root_directory, default_branch)";

const MAX_COMMIT_MESSAGE_LENGTH = 4000;
const MAX_REVERT_PATHS = 200;

type ChangesSandboxRecord = {
  sandbox_id: string;
  root_directory: string | null;
  working_branch: string | null;
  base_branch: string | null;
  billing_source?: string | null;
  billing_team_id?: string | null;
  billing_project_id?: string | null;
  vercel_team_id: string | null;
  vercel_project_id: string | null;
  repo:
    | { root_directory?: string | null; default_branch?: string | null }
    | Array<{ root_directory?: string | null; default_branch?: string | null }>
    | null;
};

type ShellResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type SandboxChangesRouteDeps = {
  loadOwnedSandboxRouteContext: typeof loadOwnedSandboxRouteContext;
  renewSandboxActivityLease: typeof renewSandboxActivityLease;
  touchSandboxLastActive: typeof touchSandboxLastActive;
  /** Runs a shell command through the exec route with the caller's auth. */
  runExec: (
    request: Request,
    sandboxRecordId: string,
    command: string
  ) => Promise<ShellResult>;
};

async function runExecViaRoute(
  request: Request,
  sandboxRecordId: string,
  command: string
): Promise<ShellResult> {
  const { createSandboxExecPostHandler } = await import("../exec/route");
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  headers.delete("content-length");
  const response = await createSandboxExecPostHandler()(
    new Request(
      `https://internal.mogplex/api/sandbox/${sandboxRecordId}/exec`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ command }),
      }
    ),
    { params: Promise.resolve({ id: sandboxRecordId }) }
  );
  const body = (await response
    .json()
    .catch(() => ({}))) as Partial<ShellResult>;
  if (!response.ok) {
    return {
      exitCode: body.exitCode ?? 1,
      stdout: body.stdout ?? "",
      stderr: body.stderr ?? "",
      error: body.error ?? `Command failed (${response.status})`,
    };
  }
  return {
    exitCode: body.exitCode ?? null,
    stdout: body.stdout ?? "",
    stderr: body.stderr ?? "",
  };
}

const defaultDeps: SandboxChangesRouteDeps = {
  loadOwnedSandboxRouteContext,
  renewSandboxActivityLease,
  touchSandboxLastActive,
  runExec: runExecViaRoute,
};

async function runShell(
  sandbox: Sandbox,
  script: string,
  cwd: string | undefined
): Promise<ShellResult> {
  const process = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", script],
    cwd,
  });
  const [stdout, stderr, result] = await Promise.all([
    process.stdout(),
    process.stderr(),
    process.wait(),
  ]);
  return { exitCode: result.exitCode, stdout, stderr };
}

function failureMessage(result: ShellResult, fallback: string) {
  return (
    result.error || result.stderr.trim() || result.stdout.trim() || fallback
  );
}

function resolveBaseBranch(record: ChangesSandboxRecord) {
  const repo = Array.isArray(record.repo) ? record.repo[0] : record.repo;
  return record.base_branch || repo?.default_branch || null;
}

async function loadChangesContext(
  deps: SandboxChangesRouteDeps,
  request: Request,
  id: string,
  mutating: boolean
) {
  const loaded = await deps.loadOwnedSandboxRouteContext<ChangesSandboxRecord>(
    request,
    id,
    {
      select: CHANGES_ROUTE_SELECT,
      ...(mutating ? { requireCapability: "tools.bash" as const } : {}),
    }
  );
  if (!loaded.ok) {
    return {
      ok: false as const,
      response: buildSandboxRouteErrorResponse(loaded),
    };
  }
  if (!loaded.sandbox) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sandbox is not ready" },
        { status: 409 }
      ),
    };
  }
  await deps.renewSandboxActivityLease(loaded.sandbox);
  return {
    ok: true as const,
    sandbox: loaded.sandbox,
    cwd: loaded.rootDirectory || undefined,
    baseBranch: resolveBaseBranch(loaded.record),
  };
}

async function readStatus(
  sandbox: Sandbox,
  cwd: string | undefined,
  baseBranch: string | null
) {
  const result = await runShell(
    sandbox,
    buildChangesStatusScript(baseBranch),
    cwd
  );
  if (result.exitCode !== 0) {
    throw new Error(failureMessage(result, "Could not read sandbox changes"));
  }
  return parseChangesOutput(result.stdout, baseBranch);
}

export function createSandboxChangesGetHandler(
  overrides: Partial<SandboxChangesRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ): Promise<Response> {
    const { id } = await params;
    const path = new URL(request.url).searchParams.get("path");
    if (path !== null && !isSafeRepoPath(path)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    try {
      const ctx = await loadChangesContext(deps, request, id, false);
      if (!ctx.ok) return ctx.response;
      if (path !== null) {
        const result = await runShell(
          ctx.sandbox,
          buildFileDiffScript(path),
          ctx.cwd
        );
        if (result.exitCode !== 0) {
          return NextResponse.json(
            { error: failureMessage(result, "Could not read the diff") },
            { status: 500 }
          );
        }
        return NextResponse.json({ path, diff: result.stdout });
      }
      const changes = await readStatus(ctx.sandbox, ctx.cwd, ctx.baseBranch);
      await deps.touchSandboxLastActive(id);
      return NextResponse.json(changes);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read changes";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

type ChangesAction =
  | { action: "revert"; paths: string[] }
  | {
      action: "commit";
      message: string;
      push?: boolean;
      openPullRequest?: boolean;
    };

function parseAction(body: unknown): ChangesAction | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid body" };
  const record = body as Record<string, unknown>;
  if (record.action === "revert") {
    const paths = Array.isArray(record.paths)
      ? record.paths.filter((path): path is string => typeof path === "string")
      : [];
    if (paths.length === 0 || paths.length > MAX_REVERT_PATHS) {
      return { error: "paths must list 1 to 200 files" };
    }
    if (!paths.every(isSafeRepoPath)) return { error: "Invalid path" };
    return { action: "revert", paths };
  }
  if (record.action === "commit") {
    const message =
      typeof record.message === "string" ? record.message.trim() : "";
    if (!message || message.length > MAX_COMMIT_MESSAGE_LENGTH) {
      return { error: "A commit message is required" };
    }
    return {
      action: "commit",
      message,
      push: record.push === true,
      openPullRequest: record.openPullRequest === true,
    };
  }
  return { error: "Unknown action" };
}

export function createSandboxChangesPostHandler(
  overrides: Partial<SandboxChangesRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ): Promise<Response> {
    const { id } = await params;
    const action = parseAction(await request.json().catch(() => null));
    if ("error" in action) {
      return NextResponse.json({ error: action.error }, { status: 400 });
    }
    try {
      const ctx = await loadChangesContext(deps, request, id, true);
      if (!ctx.ok) return ctx.response;
      if (action.action === "revert") {
        const result = await runShell(
          ctx.sandbox,
          buildRevertScript(action.paths),
          ctx.cwd
        );
        if (result.exitCode !== 0) {
          return NextResponse.json(
            { error: failureMessage(result, "Revert failed") },
            { status: 500 }
          );
        }
        const changes = await readStatus(ctx.sandbox, ctx.cwd, ctx.baseBranch);
        await deps.touchSandboxLastActive(id);
        return NextResponse.json({ reverted: action.paths, changes });
      }
      if (!ctx.baseBranch) {
        return NextResponse.json(
          { error: "This sandbox has no base branch to deliver against." },
          { status: 409 }
        );
      }
      const result = await deps.runExec(
        request,
        id,
        buildCommitScript({
          message: action.message,
          baseBranch: ctx.baseBranch,
          push: action.push,
          openPullRequest: action.openPullRequest,
        })
      );
      if (result.exitCode !== 0) {
        return NextResponse.json(
          { error: failureMessage(result, "Commit failed") },
          { status: 500 }
        );
      }
      const changes = await readStatus(ctx.sandbox, ctx.cwd, ctx.baseBranch);
      await deps.touchSandboxLastActive(id);
      return NextResponse.json({
        ...parseCommitOutput(result.stdout),
        changes,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sandbox change action failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const GET = createSandboxChangesGetHandler();
export const POST = createSandboxChangesPostHandler();
