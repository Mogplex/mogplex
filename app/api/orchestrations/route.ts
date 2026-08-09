import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  createOrchestrationRun,
  listOrchestrationRuns,
} from "@/lib/orchestrations/store";
import { isOrchestrationApprovalMode } from "@/lib/orchestrations/status";
import {
  validateOrchestrationBranchName,
  validateOrchestrationRootDirectory,
} from "@/lib/orchestrations/validation";
import { getOwnedRepo } from "@/lib/repos";
import type { CreateOrchestrationRunInput } from "@/lib/orchestrations/store";

const MAX_TITLE_LENGTH = 500;
const MAX_REQUEST_LENGTH = 100_000;
const MAX_LIST_LIMIT = 200;

type OwnedRepoRow = { id: string; default_branch: string | null };

type OrchestrationsRouteDeps = {
  requireUserId: typeof requireUserId;
  listOrchestrationRuns: typeof listOrchestrationRuns;
  createOrchestrationRun: typeof createOrchestrationRun;
  getOwnedRepo: (
    repoId: string,
    userId: string,
    select?: string
  ) => Promise<OwnedRepoRow | null>;
};

function buildDeps(
  overrides: Partial<OrchestrationsRouteDeps>
): OrchestrationsRouteDeps {
  return {
    requireUserId,
    listOrchestrationRuns,
    createOrchestrationRun,
    getOwnedRepo,
    ...overrides,
  };
}

export function createOrchestrationsGetHandler(
  overrides: Partial<OrchestrationsRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function GET(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const params = new URL(request.url).searchParams;
    const repoId = params.get("repoId");
    const rawLimit = Number.parseInt(params.get("limit") ?? "", 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), MAX_LIST_LIMIT)
      : undefined;
    try {
      const runs = await deps.listOrchestrationRuns({
        userId,
        repoId: repoId || null,
        limit,
      });
      return NextResponse.json({ runs });
    } catch (error) {
      console.error("[orchestrations] failed to list runs", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to load orchestration runs" },
        { status: 500 }
      );
    }
  };
}

type ParsedCreateBody = Omit<
  CreateOrchestrationRunInput,
  "userId" | "baseBranch"
> & {
  baseBranch?: string;
};

function parseCreateBody(body: unknown): ParsedCreateBody | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;

  if (typeof record.repoId !== "string" || record.repoId.length === 0) {
    return { error: "repoId is required" };
  }
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    return {
      error: `title must be 1-${MAX_TITLE_LENGTH} characters`,
    };
  }
  const request =
    typeof record.request === "string" ? record.request.trim() : "";
  if (request.length === 0 || request.length > MAX_REQUEST_LENGTH) {
    return { error: "request must be a non-empty string" };
  }

  const parsed: ParsedCreateBody = {
    repoId: record.repoId,
    title,
    request,
  };

  if (record.baseBranch !== undefined && record.baseBranch !== null) {
    const branch = validateOrchestrationBranchName(record.baseBranch);
    if (!branch.ok) return { error: `baseBranch: ${branch.error}` };
    parsed.baseBranch = branch.value;
  }
  const rootDirectory = validateOrchestrationRootDirectory(
    record.rootDirectory
  );
  if (!rootDirectory.ok) {
    return { error: `rootDirectory: ${rootDirectory.error}` };
  }
  parsed.rootDirectory = rootDirectory.value;

  if (record.approvalMode !== undefined && record.approvalMode !== null) {
    if (!isOrchestrationApprovalMode(record.approvalMode)) {
      return { error: "approvalMode is not a known approval mode" };
    }
    parsed.approvalMode = record.approvalMode;
  }
  return parsed;
}

export function createOrchestrationsPostHandler(
  overrides: Partial<OrchestrationsRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be JSON" },
        { status: 400 }
      );
    }
    const parsed = parseCreateBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    try {
      const repo = await deps.getOwnedRepo(
        parsed.repoId,
        userId,
        "id, default_branch"
      );
      if (!repo) {
        return NextResponse.json({ error: "Repo not found" }, { status: 404 });
      }
      const run = await deps.createOrchestrationRun({
        ...parsed,
        userId,
        baseBranch: parsed.baseBranch ?? repo.default_branch ?? "main",
      });
      return NextResponse.json({ run }, { status: 201 });
    } catch (error) {
      console.error("[orchestrations] failed to create run", {
        userId,
        repoId: parsed.repoId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to create orchestration run" },
        { status: 500 }
      );
    }
  };
}

export const GET = createOrchestrationsGetHandler();
export const POST = createOrchestrationsPostHandler();
