import type { MemoryLane, Memory, MemoryScope } from "@/lib/memories-client";
import { validateMetadata } from "@/lib/memories-validation";

function normalizeScopeValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function compactMemoryScope(
  scope?: MemoryScope
): MemoryScope | undefined {
  if (!scope) return undefined;

  const normalized: MemoryScope = {};

  const repoId = normalizeScopeValue(scope.repoId);
  if (repoId) normalized.repoId = repoId;

  const workspaceSessionId = normalizeScopeValue(scope.workspaceSessionId);
  if (workspaceSessionId) {
    normalized.workspaceSessionId = workspaceSessionId;
  }

  const conversationId = normalizeScopeValue(scope.conversationId);
  if (conversationId) normalized.conversationId = conversationId;

  if (scope.resourceScope === "personal" || scope.resourceScope === "team") {
    normalized.resourceScope = scope.resourceScope;
  }

  const productTeamId = normalizeScopeValue(scope.productTeamId);
  if (productTeamId) normalized.productTeamId = productTeamId;

  const sandboxId = normalizeScopeValue(scope.sandboxId);
  if (sandboxId) normalized.sandboxId = sandboxId;

  const source = normalizeScopeValue(scope.source);
  if (source) normalized.source = source;

  const agent = normalizeScopeValue(scope.agent);
  if (agent) normalized.agent = agent;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function applyScopeFilters<
  Query extends {
    contains: (column: string, value: Record<string, unknown>) => Query;
    is: (column: string, value: null) => Query;
  },
>(query: Query, scope?: MemoryScope): Query {
  const normalized = compactMemoryScope(scope);
  if (!normalized) return query;

  const metadataFilter: Record<string, unknown> = {};
  if (normalized.repoId) metadataFilter.repo_id = normalized.repoId;
  if (normalized.workspaceSessionId) {
    metadataFilter.workspace_session_id = normalized.workspaceSessionId;
  }
  if (normalized.conversationId) {
    metadataFilter.conversation_id = normalized.conversationId;
  }
  if (normalized.productTeamId) {
    metadataFilter.product_team_id = normalized.productTeamId;
  }

  const scopedQuery =
    Object.keys(metadataFilter).length > 0
      ? query.contains("metadata", metadataFilter)
      : query;

  if (normalized.resourceScope === "personal") {
    return scopedQuery.is("metadata->>product_team_id", null);
  }

  return scopedQuery;
}

export function memoryMatchesScope(memory: Memory, scope?: MemoryScope) {
  const normalized = compactMemoryScope(scope);
  if (!normalized) return true;

  const metadata = memory.metadata ?? {};

  if (normalized.repoId && metadata.repo_id !== normalized.repoId) {
    return false;
  }
  if (
    normalized.workspaceSessionId &&
    metadata.workspace_session_id !== normalized.workspaceSessionId
  ) {
    return false;
  }
  if (
    normalized.conversationId &&
    metadata.conversation_id !== normalized.conversationId
  ) {
    return false;
  }
  if (
    normalized.productTeamId &&
    metadata.product_team_id !== normalized.productTeamId
  ) {
    return false;
  }
  if (
    normalized.resourceScope === "personal" &&
    metadata.product_team_id != null
  ) {
    return false;
  }

  return true;
}

export function getMemoryScopeForLane(
  lane: MemoryLane,
  scope?: MemoryScope
): MemoryScope | undefined {
  const normalized = compactMemoryScope(scope);
  if (!normalized) return undefined;

  if (lane === "session") {
    // A workspace session is the broad container; a conversation ID narrows
    // within that container when one exists.
    return compactMemoryScope({
      repoId: normalized.repoId ?? null,
      workspaceSessionId: normalized.workspaceSessionId ?? null,
      conversationId: normalized.conversationId ?? null,
      resourceScope: normalized.resourceScope ?? null,
      productTeamId: normalized.productTeamId ?? null,
    });
  }

  return compactMemoryScope({
    repoId: normalized.repoId ?? null,
    resourceScope: normalized.resourceScope ?? null,
    productTeamId: normalized.productTeamId ?? null,
  });
}

export function getRepoScopedSearchScope(scope?: MemoryScope) {
  const normalized = compactMemoryScope(scope);
  if (!normalized) return undefined;
  return compactMemoryScope({
    repoId: normalized.repoId ?? null,
    resourceScope: normalized.resourceScope ?? null,
    productTeamId: normalized.productTeamId ?? null,
  });
}

export function buildLaneScopedMetadata(
  lane: MemoryLane,
  metadata?: Record<string, unknown>,
  scope?: MemoryScope
): Record<string, unknown> | undefined {
  const normalized = compactMemoryScope(scope);
  const merged: Record<string, unknown> = {
    ...metadata,
  };

  if (normalized?.repoId) merged.repo_id = normalized.repoId;
  if (normalized?.resourceScope) {
    merged.resource_scope = normalized.resourceScope;
  }
  if (normalized?.productTeamId) {
    merged.product_team_id = normalized.productTeamId;
  }
  if (
    (lane === "session" || lane === "episodic") &&
    normalized?.workspaceSessionId
  ) {
    merged.workspace_session_id = normalized.workspaceSessionId;
  }
  if (lane === "session" && normalized?.conversationId) {
    merged.conversation_id = normalized.conversationId;
  }
  if (normalized?.sandboxId) merged.sandbox_id = normalized.sandboxId;
  if (normalized?.source) merged.source = normalized.source;
  if (normalized?.agent) merged.agent = normalized.agent;

  return validateMetadata(Object.keys(merged).length > 0 ? merged : undefined);
}
