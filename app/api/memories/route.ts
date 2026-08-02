import { NextResponse } from "next/server";
import {
  createMemoriesClient,
  listByLane,
  addToLane,
  searchMemories,
  buildLaneScopedMetadata,
  editMemory,
  forgetMemory,
  getMemoryScopeForLane,
  isValidLane,
  validateMetadata,
  MAX_CONTENT_LENGTH,
  MemoryNotFoundError,
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
import { requireUserId } from "@/lib/auth";
import type { MemoryLane, MemoryScope } from "@/lib/memories-client";
import type { NextRequest } from "next/server";

const LANES: MemoryLane[] = ["session", "semantic", "episodic", "procedural"];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readScopedValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readScopeFromSearchParams(req: NextRequest): MemoryScope | undefined {
  const scope: MemoryScope = {};
  const repoId = readScopedValue(req.nextUrl.searchParams.get("repoId"));
  if (repoId) scope.repoId = repoId;

  const workspaceSessionId = readScopedValue(
    req.nextUrl.searchParams.get("workspaceSessionId")
  );
  if (workspaceSessionId) scope.workspaceSessionId = workspaceSessionId;

  const conversationId = readScopedValue(
    req.nextUrl.searchParams.get("conversationId")
  );
  if (conversationId) scope.conversationId = conversationId;

  return Object.keys(scope).length > 0 ? scope : undefined;
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

function getMemorySearchScope(
  lane: MemoryLane | null,
  scope?: MemoryScope
): MemoryScope | undefined {
  if (lane) return getMemoryScopeForLane(lane, scope);
  return scope?.repoId ? { repoId: scope.repoId } : undefined;
}

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const laneParam = req.nextUrl.searchParams.get("lane");
  const query = req.nextUrl.searchParams.get("q");
  const resourceScope = await resolveMemoryResourceScope({
    request: req,
    userId,
    value: req.nextUrl.searchParams.get(MEMORY_RESOURCE_SCOPE_PARAM),
  });
  if (!resourceScope.ok) {
    return NextResponse.json(
      { error: resourceScope.error },
      { status: resourceScope.status }
    );
  }
  const scope = mergeMemoryScopes(
    readScopeFromSearchParams(req),
    resourceScope.memoryScope
  );

  if (laneParam && !isValidLane(laneParam)) {
    return NextResponse.json({ error: "Invalid lane" }, { status: 400 });
  }
  const lane = laneParam as MemoryLane | null;

  const client = createMemoriesClient(userId);

  try {
    if (query) {
      const memories = await searchMemories(
        client,
        query,
        lane ?? undefined,
        20,
        getMemorySearchScope(lane, scope)
      );
      return NextResponse.json(memories);
    }

    if (lane) {
      const memories = await listByLane(
        client,
        lane,
        50,
        getMemoryScopeForLane(lane, scope)
      );
      return NextResponse.json(memories);
    }

    const [session, semantic, episodic, procedural] = await Promise.all(
      LANES.map((l) =>
        listByLane(client, l, 50, getMemoryScopeForLane(l, scope))
      )
    );
    return NextResponse.json({ session, semantic, episodic, procedural });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Memories request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = (await req.json()) as Record<string, unknown>;
  const { lane, content, metadata } = body;
  if (!isValidLane(lane))
    return NextResponse.json({ error: "Invalid lane" }, { status: 400 });
  if (!content || typeof content !== "string")
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  if (content.length > MAX_CONTENT_LENGTH)
    return NextResponse.json(
      { error: `Content exceeds ${MAX_CONTENT_LENGTH} characters` },
      { status: 413 }
    );

  let safeMetadata: Record<string, unknown> | undefined;
  try {
    safeMetadata = validateMetadata(metadata);
  } catch (err) {
    if (err instanceof InvalidMetadataError)
      return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  try {
    const client = createMemoriesClient(userId);
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
      lane,
      content,
      buildLaneScopedMetadata(lane, safeMetadata, scope),
      { skipEmbedding: lane === "session" }
    );
    return NextResponse.json(memory);
  } catch (err) {
    if (err instanceof InvalidMetadataError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof MemoryScopeValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to add memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  // Intentionally accepts only { id, content } — metadata edits are not
  // supported on this route. If support is added later, run the new metadata
  // through `validateMetadata()` (see POST) before passing to `editMemory`.
  const { id, content } = await req.json();
  if (!id || typeof id !== "string" || !UUID_RE.test(id))
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!content || typeof content !== "string")
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  if (content.length > MAX_CONTENT_LENGTH)
    return NextResponse.json(
      { error: `Content exceeds ${MAX_CONTENT_LENGTH} characters` },
      { status: 413 }
    );

  const client = createMemoriesClient(userId);

  try {
    await editMemory(client, id, content);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MemoryNotFoundError)
      return NextResponse.json({ error: err.message }, { status: 404 });
    const message =
      err instanceof Error ? err.message : "Failed to edit memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !UUID_RE.test(id))
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const client = createMemoriesClient(userId);

  try {
    await forgetMemory(client, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MemoryNotFoundError)
      return NextResponse.json({ error: err.message }, { status: 404 });
    const message =
      err instanceof Error ? err.message : "Failed to delete memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
