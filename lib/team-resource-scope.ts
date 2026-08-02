import {
  hasCapability,
  readActiveTeamIdHeader,
  resolveActiveTeamCapabilities,
  type Capability,
} from "@/lib/team-capabilities";

export type ResourceOwnerType = "user" | "team";

export type ProductResourceScope =
  | {
      kind: "personal";
      userId: string;
      productTeamId: null;
    }
  | {
      kind: "team";
      userId: string;
      productTeamId: string;
    };

export type ProductResourceScopeResolution =
  | {
      ok: true;
      scope: ProductResourceScope;
      capabilities?: ReadonlySet<Capability>;
    }
  | { ok: false; status: 403 | 500; error: string };

export type ResourceOwnershipInsert = {
  user_id: string;
  owner_type: ResourceOwnerType;
  owner_user_id: string | null;
  product_team_id: string | null;
  created_by_user_id: string | null;
};

export async function resolveProductResourceScope(input: {
  request: Request;
  userId: string;
  requiredCapability?: Capability;
  resolveActiveTeamCapabilities?: typeof resolveActiveTeamCapabilities;
}): Promise<ProductResourceScopeResolution> {
  const productTeamId = readActiveTeamIdHeader(input.request);
  if (!productTeamId) {
    return {
      ok: true,
      scope: {
        kind: "personal",
        userId: input.userId,
        productTeamId: null,
      },
    };
  }

  const resolve =
    input.resolveActiveTeamCapabilities ?? resolveActiveTeamCapabilities;
  const activeTeam = await resolve(input.userId, productTeamId);
  if (!activeTeam.ok) {
    return {
      ok: false,
      status: activeTeam.status,
      error: activeTeam.error,
    };
  }
  if (
    input.requiredCapability &&
    !hasCapability(
      activeTeam.capabilities ?? new Set(),
      input.requiredCapability
    )
  ) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden",
    };
  }

  return {
    ok: true,
    scope: {
      kind: "team",
      userId: input.userId,
      productTeamId,
    },
    capabilities: activeTeam.capabilities,
  };
}

export function buildResourceOwnershipInsert(
  scope: ProductResourceScope
): ResourceOwnershipInsert {
  if (scope.kind === "team") {
    return {
      user_id: scope.userId,
      owner_type: "team",
      owner_user_id: null,
      product_team_id: scope.productTeamId,
      created_by_user_id: scope.userId,
    };
  }

  return {
    user_id: scope.userId,
    owner_type: "user",
    owner_user_id: scope.userId,
    product_team_id: null,
    created_by_user_id: scope.userId,
  };
}

type OwnerScopedQuery<Query> = {
  eq: (
    column: "owner_type" | "owner_user_id" | "product_team_id",
    value: string
  ) => Query;
  is: (column: "product_team_id", value: null) => Query;
};

export function applyResourceOwnerScope<Query extends OwnerScopedQuery<Query>>(
  query: Query,
  scope: ProductResourceScope
): Query {
  if (scope.kind === "team") {
    return query
      .eq("owner_type", "team")
      .eq("product_team_id", scope.productTeamId);
  }

  return query
    .eq("owner_type", "user")
    .eq("owner_user_id", scope.userId)
    .is("product_team_id", null);
}
