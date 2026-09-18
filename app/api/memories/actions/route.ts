import { NextResponse } from "next/server";
import {
  createMemoriesClient,
  addToLane,
  buildLaneScopedMetadata,
  isValidLane,
  vacuum,
  MAX_CHECKPOINT_LABEL_LENGTH,
  InvalidMetadataError,
} from "@/lib/memories-client";
import {
  MemoryScopeValidationError,
  validateOwnedMemoryScope,
} from "@/lib/memory-scope-validation";
import {
  MEMORY_RESOURCE_SCOPE_PARAM,
  resolveMemoryResourceScope,
} from "@/lib/memory-resource-scope";
import { pruneNoise } from "@/lib/memories-maintenance";
import { requireUserId } from "@/lib/auth";
import type {
  MemoriesClient,
  MemoryLane,
  MemoryScope,
} from "@/lib/memories-client";
import type { NextRequest } from "next/server";

function readScopedValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readScopeFromBody(
  body: Record<string, unknown>
): MemoryScope | undefined {
  const scope: MemoryScope = {};
  const repoId = readScopedValue(body.repoId);
  if (repoId) scope.repoId = repoId;

  const workspaceSessionId = readScopedValue(body.workspaceSessionId);
  if (workspaceSessionId) scope.workspaceSessionId = workspaceSessionId;

  const conversationId = readScopedValue(body.conversationId);
  if (conversationId) scope.conversationId = conversationId;

  const sandboxId = readScopedValue(body.sandboxId);
  if (sandboxId) scope.sandboxId = sandboxId;

  const source = readScopedValue(body.source);
  if (source) scope.source = source;

  const agent = readScopedValue(body.agent);
  if (agent) scope.agent = agent;

  return Object.keys(scope).length > 0 ? scope : undefined;
}

function mergeMemoryScopes(
  ...scopes: Array<MemoryScope | undefined>
): MemoryScope | undefined {
  const merged = Object.assign({}, ...scopes.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export type MemoriesActionsDeps = {
  requireUserId: typeof requireUserId;
  createMemoriesClient: (userId: string) => MemoriesClient;
};

const defaultDeps: MemoriesActionsDeps = {
  requireUserId,
  createMemoriesClient: (userId) => createMemoriesClient(userId),
};

export function createMemoriesActionsPostHandler(
  deps: MemoriesActionsDeps = defaultDeps
) {
  return async function POST(req: NextRequest) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    return runMemoryAction(req, userId, body, deps);
  };
}

async function runMemoryAction(
  req: NextRequest,
  userId: string,
  body: Record<string, unknown>,
  deps: MemoriesActionsDeps
) {
  const { action, lane, label } = body;
  try {
    const client = deps.createMemoriesClient(userId);

    if (action === "compact") {
      await vacuum(client);
      return NextResponse.json({ ok: true });
    }

    if (action === "prune_noise") {
      const pruned = await pruneNoise(client);
      return NextResponse.json({ ok: true, pruned });
    }

    if (action === "checkpoint") {
      if (
        label !== undefined &&
        label !== null &&
        (typeof label !== "string" ||
          label.length > MAX_CHECKPOINT_LABEL_LENGTH)
      ) {
        return NextResponse.json(
          {
            error: `Label must be a string up to ${MAX_CHECKPOINT_LABEL_LENGTH} characters`,
          },
          { status: 400 }
        );
      }
      const safeLabel =
        typeof label === "string" && label ? label : new Date().toISOString();
      const targetLane: MemoryLane = isValidLane(lane) ? lane : "session";
      const resourceScope = await resolveMemoryResourceScope({
        request: req,
        userId,
        value: body[MEMORY_RESOURCE_SCOPE_PARAM],
      });
      if (!resourceScope.ok) {
        return NextResponse.json(
          { error: resourceScope.error },
          { status: resourceScope.status }
        );
      }
      const scope = await validateOwnedMemoryScope(
        userId,
        mergeMemoryScopes(readScopeFromBody(body), resourceScope.memoryScope),
        undefined,
        { productScope: resourceScope.productScope }
      );
      const memory = await addToLane(
        client,
        targetLane,
        `[checkpoint] ${safeLabel}`,
        buildLaneScopedMetadata(
          targetLane,
          { checkpoint: true, label: safeLabel },
          scope
        )
      );
      return NextResponse.json(memory);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof InvalidMetadataError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof MemoryScopeValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = createMemoriesActionsPostHandler();
