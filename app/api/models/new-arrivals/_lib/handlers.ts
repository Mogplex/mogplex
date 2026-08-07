import { NextResponse } from "next/server";
import { isCatalogModelVisible } from "@/lib/models/catalog-visibility";
import {
  detectNewModelArrivals,
  maxArrivalCreatedAt,
  type NewModelArrival,
} from "@/lib/models/new-arrivals";
import { filterModelsToUsableScopes } from "@/lib/models/new-arrival-scoping";

import type { NewArrivalsDeps, ProfileModelSettings } from "./deps";

export function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function okResponse() {
  return NextResponse.json({ ok: true });
}

export async function resolveNewModels(
  deps: NewArrivalsDeps,
  userId: string,
  settings: ProfileModelSettings
) {
  const [
    { data: candidates, error: candidatesErr },
    { data: prefIds, error: prefErr },
  ] = await Promise.all([
    deps.listCandidateModels(),
    deps.listUserPreferenceModelIds(userId),
  ]);

  if (candidatesErr) throw new Error(candidatesErr.message);
  if (prefErr) throw new Error(prefErr.message);

  const visible = (candidates ?? []).filter(isCatalogModelVisible);
  return detectNewModelArrivals({
    models: visible,
    seenAt: settings.models_seen_at,
    preferenceModelIds: new Set(prefIds),
  });
}

export async function resolveArrivalsOrError(
  deps: NewArrivalsDeps,
  userId: string,
  settings: ProfileModelSettings
): Promise<{ arrivals: NewModelArrival[] } | { error: NextResponse }> {
  try {
    return { arrivals: await resolveNewModels(deps, userId, settings) };
  } catch (error) {
    return {
      error: jsonError(
        error instanceof Error ? error.message : "Failed to load models"
      ),
    };
  }
}

// Move the high-water mark to the newest acknowledged created_at, or leave it
// untouched when nothing was new. Returns an error response on write failure.
export async function advanceCursor(
  deps: NewArrivalsDeps,
  userId: string,
  arrivals: NewModelArrival[]
): Promise<NextResponse | null> {
  const seenAt = maxArrivalCreatedAt(arrivals);
  if (!seenAt) return null;
  const advance = await deps.advanceModelsSeenAt(userId, seenAt);
  return advance.error ? jsonError(advance.error.message) : null;
}

// Narrow the resolved arrivals to those usable in at least one of the user's
// scopes. Scopes are only loaded when there is something to filter, so the
// common no-arrivals path stays a single round-trip.
export async function scopeArrivalsForPopup(
  deps: NewArrivalsDeps,
  userId: string,
  arrivals: NewModelArrival[]
): Promise<
  { models: NewModelArrival[]; degraded: boolean } | { error: NextResponse }
> {
  if (arrivals.length === 0) return { models: [], degraded: false };
  const {
    data: scopes,
    error,
    degraded,
  } = await deps.loadUserUsabilityScopes(userId);
  if (error || !scopes) {
    return {
      error: jsonError(error?.message ?? "Failed to load usable scopes"),
    };
  }
  return {
    models: filterModelsToUsableScopes(arrivals, scopes),
    degraded: degraded ?? false,
  };
}

// The popup only needs identity fields; created_at is an internal cursor input.
export function toPopupModel({ id, name, provider }: NewModelArrival) {
  return { id, name, provider };
}

export async function loadSettings(
  deps: NewArrivalsDeps,
  userId: string
): Promise<{ settings: ProfileModelSettings } | { error: NextResponse }> {
  const { data, error } = await deps.loadProfileModelSettings(userId);
  if (error || !data) {
    return {
      error: jsonError(
        error?.message ?? "Profile not found",
        error ? 500 : 404
      ),
    };
  }
  return { settings: data };
}

// Feature off: new models must arrive disabled. Pin explicit-off rows for them
// and advance the high-water mark so they are not reprocessed. No popup.
//
// Deliberately not gated on `degraded`, unlike acknowledgeArrivals. Scope only
// decides what the popup *displays*; with the feature off there is no popup and
// every new model must arrive disabled regardless of where it could be used. The
// disable is also self-limiting — it writes preference rows, which exclude those
// models from future arrival detection — so the cursor advance that follows
// cannot hide anything the disable did not already account for.
//
// Same reasoning for applyDisableAction and the PATCH toggle: an explicit user
// decision about the whole catalog, not a scoped view of it. The cursor advance
// is the only scope-dependent write on this route.
export async function reconcileFeatureOff(
  deps: NewArrivalsDeps,
  userId: string,
  arrivals: NewModelArrival[]
): Promise<NextResponse> {
  if (arrivals.length > 0) {
    const disable = await deps.disableModelsForUser(
      userId,
      arrivals.map((model) => model.id)
    );
    if (disable.error) return jsonError(disable.error.message);
    const failure = await advanceCursor(deps, userId, arrivals);
    if (failure) return failure;
  }
  return NextResponse.json({ models: [], autoEnable: false });
}

// Acknowledge exactly the models we just resolved by moving the cursor to their
// newest created_at. Anything inserted after this read keeps a later created_at
// and is surfaced next time rather than silently skipped.
//
// Skipped on anything short of a clean scope read. The cursor advances over the
// whole arrival set while the popup shows only what is usable in some scope, so
// if scope resolution was incomplete, models that would have been displayed
// were not — and advancing past them marks them seen permanently, so they never
// resurface once the blip clears.
//
// `error` counts as well as `degraded`, and the asymmetry is the point:
// `degraded` is a partial failure (one team's allowlist unreadable) while
// `error` is a total one (team_members or the vault down), which loses strictly
// more information. Holding the cursor for the partial case and advancing on
// the total one would be exactly backwards. The GET path is already consistent
// — scopeArrivalsForPopup 500s on `error` and never reaches the cursor.
//
// Costs one scope load on a rare user action, which is worth it: this is the
// only unrecoverable write on the path.
export async function acknowledgeArrivals(
  deps: NewArrivalsDeps,
  userId: string,
  arrivals: NewModelArrival[]
): Promise<NextResponse> {
  const { degraded, error } = await deps.loadUserUsabilityScopes(userId);
  if (degraded || error) return okResponse();
  return (await advanceCursor(deps, userId, arrivals)) ?? okResponse();
}

// Popup "stop auto-adding": flip the feature off first so that a later disable
// failure is lazily reconciled by the next GET (which now sees the flag off),
// then pin the currently-shown models to disabled.
export async function applyDisableAction(
  deps: NewArrivalsDeps,
  userId: string,
  newModels: NewModelArrival[]
): Promise<NextResponse | null> {
  const off = await deps.setAutoEnableNewModels(userId, false);
  if (off.error) return jsonError(off.error.message);

  const disable = await deps.disableModelsForUser(
    userId,
    newModels.map((model) => model.id)
  );
  if (disable.error) return jsonError(disable.error.message);

  return null;
}
