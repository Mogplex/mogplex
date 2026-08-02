import {
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import type { MemoryResourceScope, MemoryScope } from "@/lib/memories-client";

export type MemoryResourceScopeFilter = "all" | MemoryResourceScope;

export const MEMORY_RESOURCE_SCOPE_PARAM = "resourceScope";
export const MEMORY_TEAM_CAPABILITY = "tools.memories";

export type MemoryResourceScopeResolution =
  | {
      ok: true;
      filter: MemoryResourceScopeFilter;
      memoryScope?: Pick<MemoryScope, "resourceScope" | "productTeamId">;
      productScope?: ProductResourceScope;
    }
  | {
      ok: false;
      status: 400 | 403 | 500;
      error: string;
    };

export function parseMemoryResourceScope(
  value: unknown
): MemoryResourceScopeFilter | null {
  if (value === undefined || value === null || value === "") return "all";
  if (value === "all" || value === "personal" || value === "team") {
    return value;
  }
  return null;
}

export async function resolveMemoryResourceScope(input: {
  request: Request;
  userId: string;
  value: unknown;
  resolveProductResourceScope?: typeof resolveProductResourceScope;
}): Promise<MemoryResourceScopeResolution> {
  const filter = parseMemoryResourceScope(input.value);
  if (!filter) {
    return {
      ok: false,
      status: 400,
      error: "Invalid memory scope",
    };
  }

  if (filter === "all") {
    return { ok: true, filter };
  }

  if (filter === "personal") {
    return {
      ok: true,
      filter,
      memoryScope: { resourceScope: "personal" },
    };
  }

  const resolve =
    input.resolveProductResourceScope ?? resolveProductResourceScope;
  const productScope = await resolve({
    request: input.request,
    userId: input.userId,
    requiredCapability: MEMORY_TEAM_CAPABILITY,
  });
  if (!productScope.ok) {
    return productScope;
  }
  if (productScope.scope.kind !== "team") {
    return {
      ok: false,
      status: 400,
      error: "Team memory scope requires an active team",
    };
  }

  return {
    ok: true,
    filter,
    memoryScope: {
      resourceScope: "team",
      productTeamId: productScope.scope.productTeamId,
    },
    productScope: productScope.scope,
  };
}
