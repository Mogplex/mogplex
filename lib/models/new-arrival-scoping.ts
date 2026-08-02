import {
  isModelReachable,
  type UserProviderAccess,
} from "./provider-reachability";

// A "scope" is one place a user could use a model: their personal scope, or a
// team they belong to. A model is *usable* in a scope when the user can both
// reach it (provider keys / platform access for that scope) and is allowed to
// use it there (the team allowlist, or no restriction).
export type ModelUsabilityScope = {
  access: UserProviderAccess;
  // null = unrestricted (personal scope, or a team with no allowlist).
  // An empty set is a kill-switch: the scope allows no models.
  allowlist: ReadonlySet<string> | null;
};

type ScopeableModel = { id: string };

export function isModelUsableInScope(
  modelId: string,
  scope: ModelUsabilityScope
): boolean {
  if (!isModelReachable(modelId, scope.access)) return false;
  if (scope.allowlist && !scope.allowlist.has(modelId)) return false;
  return true;
}

// Keep only models the user could actually use in at least one of their scopes.
// This is the "user-usable filter": a new model is surfaced if it is usable
// anywhere the user works — not strictly scoped to one active team — so the
// arrivals popup never advertises a model the user cannot reach or is not
// allowed to use anywhere.
export function filterModelsToUsableScopes<T extends ScopeableModel>(
  models: readonly T[],
  scopes: readonly ModelUsabilityScope[]
): T[] {
  if (scopes.length === 0) return [];
  return models.filter((model) =>
    scopes.some((scope) => isModelUsableInScope(model.id, scope))
  );
}
