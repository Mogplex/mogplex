type ProductTeamScopeQuery<Query> = {
  eq: (column: "product_team_id", value: string) => Query;
  is: (column: "product_team_id", value: null) => Query;
};

/**
 * Callers must pass either a sanitized non-empty team UUID or a nullish value
 * for personal scope.
 */
export function applyProductTeamScope<
  Query extends ProductTeamScopeQuery<Query>,
>(query: Query, productTeamId: string | null | undefined): Query {
  if (productTeamId === null || productTeamId === undefined) {
    return query.is("product_team_id", null);
  }
  if (productTeamId === "") {
    throw new Error(
      "applyProductTeamScope: empty string is not a valid team id; pass null for personal scope"
    );
  }

  return query.eq("product_team_id", productTeamId);
}
