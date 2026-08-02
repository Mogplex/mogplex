// Detect models that are "new" to a given user: available, added to the
// catalog after the user's high-water mark, and not already pinned to a
// preference (explicitly enabled or disabled) by the user.

export type NewArrivalCandidate = {
  id: string;
  name: string;
  provider: string;
  created_at: string | null;
};

export type NewModelArrival = {
  id: string;
  name: string;
  provider: string;
  created_at: string;
};

export function detectNewModelArrivals({
  models,
  seenAt,
  preferenceModelIds,
}: {
  models: NewArrivalCandidate[];
  seenAt: string | null;
  preferenceModelIds: ReadonlySet<string>;
}): NewModelArrival[] {
  const seenTime = seenAt ? Date.parse(seenAt) : Number.NEGATIVE_INFINITY;

  return models
    .filter((model): model is NewArrivalCandidate & { created_at: string } => {
      if (!model.created_at) return false;
      if (preferenceModelIds.has(model.id)) return false;
      const created = Date.parse(model.created_at);
      if (!Number.isFinite(created)) return false;
      return created > seenTime;
    })
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      created_at: model.created_at,
    }));
}

// The high-water mark to persist after surfacing/acknowledging a set of
// arrivals. Using the newest *processed* created_at (a DB-sourced timestamp)
// instead of the wall clock avoids skipping models inserted between the read
// and the cursor write, and avoids app/DB clock skew. Returns null when the
// set is empty, signalling the caller to leave the cursor untouched.
export function maxArrivalCreatedAt(
  arrivals: ReadonlyArray<{ created_at: string }>
): string | null {
  let max: string | null = null;
  let maxTime = Number.NEGATIVE_INFINITY;
  for (const arrival of arrivals) {
    const time = Date.parse(arrival.created_at);
    if (Number.isFinite(time) && time > maxTime) {
      maxTime = time;
      max = arrival.created_at;
    }
  }
  return max;
}
