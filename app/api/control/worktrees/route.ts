import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  archiveWorktree,
  diffWorktree,
  listWorktrees,
  pruneWorktree,
  rebaseWorktree,
  WorktreeServiceError,
} from "@/lib/worktrees/service";

async function loadOwnedSessionRun(input: {
  userId: string;
  sessionId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("control_sessions")
    .select("repo_id, orchestration_run_id")
    .eq("id", input.sessionId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

type WorktreeRouteDeps = {
  requireUserId: typeof requireUserId;
  loadSession: typeof loadOwnedSessionRun;
  list: typeof listWorktrees;
  diff: typeof diffWorktree;
  rebase: typeof rebaseWorktree;
  archive: typeof archiveWorktree;
  prune: typeof pruneWorktree;
};

const defaultDeps: WorktreeRouteDeps = {
  requireUserId,
  loadSession: loadOwnedSessionRun,
  list: listWorktrees,
  diff: diffWorktree,
  rebase: rebaseWorktree,
  archive: archiveWorktree,
  prune: pruneWorktree,
};

export function createControlWorktreesGetHandler(
  overrides: Partial<WorktreeRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function GET(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const search = new URL(request.url).searchParams;
    const sessionId = search.get("sessionId");
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }
    const session = await deps.loadSession({ userId, sessionId });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!session.orchestration_run_id) {
      return NextResponse.json({ worktrees: [] });
    }
    const worktreeId = search.get("worktreeId");
    if (worktreeId) {
      if (!session.repo_id) {
        return NextResponse.json(
          { error: "Mission has no repository" },
          { status: 409 }
        );
      }
      try {
        return NextResponse.json(
          await deps.diff({
            userId,
            worktreeId,
            runId: session.orchestration_run_id,
            repoId: session.repo_id,
          })
        );
      } catch (error) {
        return worktreeErrorResponse(error);
      }
    }
    const worktrees = await deps.list({
      userId,
      runId: session.orchestration_run_id,
      repoId: session.repo_id,
    });
    return NextResponse.json({ worktrees });
  };
}

export function createControlWorktreesPostHandler(
  overrides: Partial<WorktreeRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      worktreeId?: unknown;
      sessionId?: unknown;
      force?: unknown;
    };
    if (typeof body.worktreeId !== "string") {
      return NextResponse.json(
        { error: "Missing worktreeId" },
        { status: 400 }
      );
    }
    if (typeof body.sessionId !== "string") {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }
    const session = await deps.loadSession({
      userId,
      sessionId: body.sessionId,
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!session.orchestration_run_id || !session.repo_id) {
      return NextResponse.json(
        { error: "Mission has no repository" },
        { status: 409 }
      );
    }
    const scopedWorktree = {
      userId,
      worktreeId: body.worktreeId,
      runId: session.orchestration_run_id,
      repoId: session.repo_id,
    };
    try {
      if (body.action === "rebase") {
        return NextResponse.json({
          worktree: await deps.rebase(scopedWorktree),
        });
      }
      if (body.action === "archive") {
        return NextResponse.json({
          worktree: await deps.archive(scopedWorktree),
        });
      }
      if (body.action === "prune") {
        return NextResponse.json({
          worktree: await deps.prune({
            ...scopedWorktree,
            force: body.force === true,
          }),
        });
      }
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
      return worktreeErrorResponse(error);
    }
  };
}

export const GET = createControlWorktreesGetHandler();
export const POST = createControlWorktreesPostHandler();

function worktreeErrorResponse(error: unknown) {
  if (error instanceof WorktreeServiceError) {
    const notFound = error.message === "Worktree not found";
    return NextResponse.json(
      { error: error.message },
      { status: notFound ? 404 : 409 }
    );
  }
  console.error("[control/worktrees] operation failed", error);
  return NextResponse.json(
    { error: "Worktree operation failed" },
    { status: 500 }
  );
}
