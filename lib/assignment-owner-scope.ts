import type { ProductResourceScope } from "@/lib/team-resource-scope";

type AssignmentQuery<Query> = {
  eq: (
    column:
      | "repos.owner_type"
      | "repos.owner_user_id"
      | "repos.product_team_id",
    value: string
  ) => Query;
  is: (column: "repos.product_team_id", value: null) => Query;
};

/** Filter the repository join directly, without building a repo-ID URL list. */
export function applyAssignmentOwnerScope<Query extends AssignmentQuery<Query>>(
  query: Query,
  scope: ProductResourceScope
): Query {
  return scope.kind === "team"
    ? query
        .eq("repos.owner_type", "team")
        .eq("repos.product_team_id", scope.productTeamId)
    : query
        .eq("repos.owner_type", "user")
        .eq("repos.owner_user_id", scope.userId)
        .is("repos.product_team_id", null);
}
