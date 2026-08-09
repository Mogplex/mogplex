import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  cancelOrchestrationRun,
  getOrchestrationRunDetails,
  updateOrchestrationRun,
} from "@/lib/orchestrations/store";
import { isOrchestrationApprovalMode } from "@/lib/orchestrations/status";
import { MAX_ORCHESTRATION_TITLE_LENGTH } from "@/lib/orchestrations/validation";
import { isUuid } from "@/lib/uuid";
import type { UpdateOrchestrationRunInput } from "@/lib/orchestrations/store";

type OrchestrationRunRouteDeps = {
  requireUserId: typeof requireUserId;
  getOrchestrationRunDetails: typeof getOrchestrationRunDetails;
  updateOrchestrationRun: typeof updateOrchestrationRun;
  cancelOrchestrationRun: typeof cancelOrchestrationRun;
};

type RouteContext = { params: Promise<{ runId: string }> };

function runNotFound() {
  return NextResponse.json({ error: "Run not found" }, { status: 404 });
}

function buildDeps(
  overrides: Partial<OrchestrationRunRouteDeps>
): OrchestrationRunRouteDeps {
  return {
    requireUserId,
    getOrchestrationRunDetails,
    updateOrchestrationRun,
    cancelOrchestrationRun,
    ...overrides,
  };
}

export function createOrchestrationRunGetHandler(
  overrides: Partial<OrchestrationRunRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function GET(_request: Request, ctx: RouteContext) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { runId } = await ctx.params;
    // Run ids are UUIDs; anything else can 404 without a database round trip
    // (PostgREST rejects non-uuid comparisons as errors, not empty results).
    if (!isUuid(runId)) return runNotFound();
    try {
      const details = await deps.getOrchestrationRunDetails({ runId, userId });
      if (!details) return runNotFound();
      return NextResponse.json(details);
    } catch (error) {
      console.error("[orchestrations] failed to load run", {
        userId,
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to load orchestration run" },
        { status: 500 }
      );
    }
  };
}

type ParsedPatchBody = Pick<
  UpdateOrchestrationRunInput,
  "title" | "approvalMode" | "metadataPatch"
>;

function parsePatchBody(body: unknown): ParsedPatchBody | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const parsed: ParsedPatchBody = {};

  if (record.title !== undefined) {
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (title.length === 0 || title.length > MAX_ORCHESTRATION_TITLE_LENGTH) {
      return {
        error: `title must be 1-${MAX_ORCHESTRATION_TITLE_LENGTH} characters`,
      };
    }
    parsed.title = title;
  }
  if (record.approvalMode !== undefined) {
    if (!isOrchestrationApprovalMode(record.approvalMode)) {
      return { error: "approvalMode is not a known approval mode" };
    }
    parsed.approvalMode = record.approvalMode;
  }
  if (record.metadata !== undefined) {
    if (
      !record.metadata ||
      typeof record.metadata !== "object" ||
      Array.isArray(record.metadata)
    ) {
      return { error: "metadata must be an object" };
    }
    parsed.metadataPatch = record.metadata as Record<string, unknown>;
  }

  if (Object.keys(parsed).length === 0) {
    return {
      error: "Provide at least one of title, approvalMode, or metadata",
    };
  }
  return parsed;
}

export function createOrchestrationRunPatchHandler(
  overrides: Partial<OrchestrationRunRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function PATCH(request: Request, ctx: RouteContext) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { runId } = await ctx.params;
    if (!isUuid(runId)) return runNotFound();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be JSON" },
        { status: 400 }
      );
    }
    const parsed = parsePatchBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    try {
      const run = await deps.updateOrchestrationRun({
        ...parsed,
        runId,
        userId,
      });
      if (!run) return runNotFound();
      return NextResponse.json({ run });
    } catch (error) {
      console.error("[orchestrations] failed to update run", {
        userId,
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to update orchestration run" },
        { status: 500 }
      );
    }
  };
}

export function createOrchestrationRunDeleteHandler(
  overrides: Partial<OrchestrationRunRouteDeps> = {}
) {
  const deps = buildDeps(overrides);

  return async function DELETE(_request: Request, ctx: RouteContext) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { runId } = await ctx.params;
    if (!isUuid(runId)) return runNotFound();
    try {
      const result = await deps.cancelOrchestrationRun({ runId, userId });
      switch (result.outcome) {
        case "not_found":
          return runNotFound();
        case "not_cancellable":
          return NextResponse.json(
            { error: "Run has already completed" },
            { status: 409 }
          );
        case "cancelled":
        case "already_cancelled":
          return NextResponse.json({ ok: true, run: result.run });
      }
    } catch (error) {
      console.error("[orchestrations] failed to cancel run", {
        userId,
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to cancel orchestration run" },
        { status: 500 }
      );
    }
  };
}

export const GET = createOrchestrationRunGetHandler();
export const PATCH = createOrchestrationRunPatchHandler();
export const DELETE = createOrchestrationRunDeleteHandler();
