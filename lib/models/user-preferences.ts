export type UserModelPreferenceRow = {
  model_id: string;
  is_enabled: boolean;
};

// Governs the default state of models the user has not explicitly toggled.
// When auto-enable is off, models that arrived after the user's high-water
// mark (`seenAt`) default to disabled until the new-arrivals reconciler pins
// an explicit row for them. This makes the off switch hold in every catalog
// path, not just the new-arrivals endpoint that does the reconciling.
export type NewModelDefaultPolicy = {
  autoEnable: boolean;
  seenAt: string | null;
};

export type EnabledStateModel = {
  id: string;
  is_available: boolean;
  created_at?: string | null;
};

// Build the default policy from a profile row, defaulting a missing/partial
// row to auto-enable on (legacy behavior) so an absent profile never silently
// withholds models.
export function buildNewModelDefaultPolicy(
  settings: {
    auto_enable_new_models?: boolean | null;
    models_seen_at?: string | null;
  } | null
): NewModelDefaultPolicy {
  return {
    autoEnable: settings?.auto_enable_new_models ?? true,
    seenAt: settings?.models_seen_at ?? null,
  };
}

export function buildUserModelPreferenceMap(
  preferences: UserModelPreferenceRow[]
) {
  return new Map(
    preferences.map((preference) => [
      preference.model_id,
      preference.is_enabled,
    ])
  );
}

function isNewModelForUser(
  createdAt: string | null | undefined,
  seenAt: string | null
) {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  const seen = seenAt ? Date.parse(seenAt) : Number.NEGATIVE_INFINITY;
  return created > seen;
}

// Resolve whether a model is enabled for a user. Explicit preference rows
// always win. For models with no row, the default is "enabled if available" —
// unless a `policy` says auto-enable is off and the model is new to the user,
// in which case it defaults to disabled. Omitting `policy` preserves the
// legacy "missing row = enabled" behavior for callers that do not serve the
// catalog (and therefore do not need the off switch applied).
export function resolveUserModelEnabledState(
  model: EnabledStateModel,
  preferenceMap: ReadonlyMap<string, boolean>,
  policy?: NewModelDefaultPolicy
) {
  const explicitPreference = preferenceMap.get(model.id);
  if (typeof explicitPreference === "boolean") return explicitPreference;
  if (
    policy &&
    !policy.autoEnable &&
    isNewModelForUser(model.created_at, policy.seenAt)
  ) {
    return false;
  }
  return model.is_available;
}
