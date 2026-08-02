import { NextResponse } from "next/server";
import { getUserId, requireUserId } from "@/lib/auth";
import { isCatalogModelVisible } from "@/lib/models/catalog-visibility";
import {
  detectNewModelArrivals,
  maxArrivalCreatedAt,
  type NewArrivalCandidate,
  type NewModelArrival,
} from "@/lib/models/new-arrivals";
import {
  filterModelsToUsableScopes,
  type ModelUsabilityScope,
} from "@/lib/models/new-arrival-scoping";
import { buildUserProviderAccess } from "@/lib/models/provider-reachability";
import { loadUserPlatformAccess } from "@/lib/platform-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadTeamAllowlistState,
  logAllowlistDegradationOnce,
} from "@/lib/team-capabilities";
import { listProviderKeys, listTeamProviderKeys } from "@/lib/vault";

type ProfileModelSettings = {
  auto_enable_new_models: boolean;
  models_seen_at: string | null;
};

type CandidateRow = NewArrivalCandidate & { is_hidden?: boolean | null };

type NewArrivalsDeps = {
  getUserId: typeof getUserId;
  requireUserId: typeof requireUserId;
  loadProfileModelSettings: (userId: string) => Promise<{
    data: ProfileModelSettings | null;
    error: { message: string } | null;
  }>;
  listCandidateModels: () => Promise<{
    data: CandidateRow[] | null;
    error: { message: string } | null;
  }>;
  listUserPreferenceModelIds: (userId: string) => Promise<{
    data: string[] | null;
    error: { message: string } | null;
  }>;
  disableModelsForUser: (
    userId: string,
    modelIds: string[]
  ) => Promise<{ error: { message: string } | null }>;
  advanceModelsSeenAt: (
    userId: string,
    seenAt: string
  ) => Promise<{ error: { message: string } | null }>;
  setAutoEnableNewModels: (
    userId: string,
    value: boolean
  ) => Promise<{ error: { message: string } | null }>;
  // Assemble the scopes a user could use a model in (their personal scope plus
  // every team they belong to). Used to keep the arrivals popup from surfacing
  // models the user cannot reach or is not allowed to use anywhere.
  loadUserUsabilityScopes: (userId: string) => Promise<{
    data: ModelUsabilityScope[] | null;
    error: { message: string } | null;
    // True when at least one team scope was dropped because its allowlist could
    // not be read, so the caller can tell a genuinely empty result from a
    // narrowed one. Required, not optional: an injected test double that omits
    // it would read as `undefined` and silently opt out of the signal, which
    // gates a persistent write below.
    degraded: boolean;
  }>;
};

const defaultNewArrivalsDeps: NewArrivalsDeps = {
  getUserId,
  requireUserId,
  async loadProfileModelSettings(userId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("auto_enable_new_models, models_seen_at")
      .eq("id", userId)
      .single();

    return {
      data: data as ProfileModelSettings | null,
      error: error ? { message: error.message } : null,
    };
  },
  async listCandidateModels() {
    const { data, error } = await supabaseAdmin
      .from("ai_models")
      .select("id, name, provider, created_at, is_hidden")
      .eq("is_available", true);

    return {
      data: data as CandidateRow[] | null,
      error: error ? { message: error.message } : null,
    };
  },
  async listUserPreferenceModelIds(userId) {
    const { data, error } = await supabaseAdmin
      .from("user_model_preferences")
      .select("model_id")
      .eq("user_id", userId);

    return {
      data: data?.map((row) => row.model_id as string) ?? null,
      error: error ? { message: error.message } : null,
    };
  },
  async disableModelsForUser(userId, modelIds) {
    if (modelIds.length === 0) return { error: null };
    const { error } = await supabaseAdmin.from("user_model_preferences").upsert(
      modelIds.map((modelId) => ({
        user_id: userId,
        model_id: modelId,
        is_enabled: false,
      })),
      { onConflict: "user_id,model_id" }
    );
    return { error: error ? { message: error.message } : null };
  },
  async advanceModelsSeenAt(userId, seenAt) {
    // Monotonic: only move the cursor forward. The `lt` guard makes the write
    // a no-op when a concurrent acknowledgement has already advanced past
    // `seenAt`, so a slow older request cannot clobber a newer value and make
    // already-acknowledged arrivals reappear. `models_seen_at` is NOT NULL, so
    // the guard always has a value to compare against.
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ models_seen_at: seenAt })
      .eq("id", userId)
      .lt("models_seen_at", seenAt);
    return { error: error ? { message: error.message } : null };
  },
  async setAutoEnableNewModels(userId, value) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ auto_enable_new_models: value })
      .eq("id", userId);
    return { error: error ? { message: error.message } : null };
  },
  async loadUserUsabilityScopes(userId) {
    // Surface failures rather than swallowing — silently treating the user as
    // "no usable scope" would hide a legitimately-usable new model behind a
    // transient Supabase/Vault outage.
    try {
      const [keys, platform, teamIds] = await Promise.all([
        listProviderKeys(userId),
        loadUserPlatformAccess(userId),
        listUserTeamIds(userId),
      ]);
      const personalProviders = new Set(keys.map((row) => row.provider));
      const platformOpts = { allowPlatformAi: platform.allowPlatformAi };

      // Personal scope: own keys + platform, no allowlist restriction.
      const scopes: ModelUsabilityScope[] = [
        {
          access: buildUserProviderAccess(personalProviders, platformOpts),
          allowlist: null,
        },
      ];

      // Team scopes: own keys + the team's keys, gated by the team allowlist.
      const teamScopes = await Promise.all(
        teamIds.map(async (teamId) => {
          const [teamKeys, allowlistState] = await Promise.all([
            listTeamProviderKeys(teamId),
            loadTeamAllowlistState(teamId),
          ]);
          // Drop just this team's scope rather than degrading it to a null
          // allowlist, which this shape reads as "no restriction" — that would
          // report a model as usable in a team whose allowlist we could not
          // read. Dropping is equally fail-closed for that team (a model is
          // only reported usable if some scope permits it) while leaving the
          // personal scope and every other team's scope intact, so one team's
          // transient read failure does not blank the whole popup.
          if (allowlistState.status === "unknown") {
            // The read itself logs the Supabase message, but not which surface
            // degraded — without a line here a silently narrower popup has no
            // trace at all. Routed through the shared suppression because this
            // endpoint is polled: an un-deduped line would flood at request
            // rate during exactly the outage it is reporting.
            logAllowlistDegradationOnce(
              "new-arrivals",
              teamId,
              allowlistState.reason,
              (message, fields) => console.warn(message, fields)
            );
            return null;
          }
          const providers = new Set([
            ...personalProviders,
            ...teamKeys.map((row) => row.provider),
          ]);
          return {
            access: buildUserProviderAccess(providers, platformOpts),
            allowlist:
              allowlistState.status === "unrestricted"
                ? null
                : new Set(allowlistState.models),
          } satisfies ModelUsabilityScope;
        })
      );
      const usableTeamScopes = teamScopes.filter((scope) => scope !== null);
      scopes.push(...usableTeamScopes);

      return {
        data: scopes,
        error: null,
        degraded: usableTeamScopes.length !== teamScopes.length,
      };
    } catch (error) {
      return {
        data: null,
        degraded: false,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Failed to load usability scopes",
        },
      };
    }
  },
};

async function listUserTeamIds(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);
  if (error) {
    throw new Error(`Failed to load team memberships: ${error.message}`);
  }
  return (data ?? []).map((row) => row.team_id as string);
}

async function resolveNewModels(
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

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function resolveArrivalsOrError(
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
async function advanceCursor(
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
async function scopeArrivalsForPopup(
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
function toPopupModel({ id, name, provider }: NewModelArrival) {
  return { id, name, provider };
}

async function loadSettings(
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
async function reconcileFeatureOff(
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

export function createNewArrivalsGetHandler(
  overrides: Partial<NewArrivalsDeps> = {}
) {
  const deps: NewArrivalsDeps = { ...defaultNewArrivalsDeps, ...overrides };

  return async function GET() {
    const userId = await deps.getUserId();
    if (!userId) {
      return NextResponse.json({ models: [], autoEnable: true });
    }

    const loaded = await loadSettings(deps, userId);
    if ("error" in loaded) return loaded.error;
    const { settings } = loaded;

    const resolved = await resolveArrivalsOrError(deps, userId, settings);
    if ("error" in resolved) return resolved.error;
    const newModels = resolved.arrivals;

    if (!settings.auto_enable_new_models) {
      return reconcileFeatureOff(deps, userId, newModels);
    }

    // Feature on: new models are already enabled by default. Surface them for
    // the popup, leaving models_seen_at untouched until the user acknowledges.
    // Scope the popup to models the user can actually use in at least one of
    // their scopes (personal or any team) so it never advertises a model they
    // cannot reach or are not allowed to use anywhere. Bookkeeping (cursor,
    // disable) stays whole-catalog; only the displayed set is scoped.
    const scoped = await scopeArrivalsForPopup(deps, userId, newModels);
    if ("error" in scoped) return scoped.error;

    // `degraded` is the server half of "some models may be hidden": dropping a
    // team scope whose allowlist we could not read is the right fail-closed
    // call, but a silently shorter list is indistinguishable from a genuinely
    // empty one without it. The popup does not render the hint yet — #769 —
    // so today this only documents the response. What it does already do is
    // gate the acknowledge path, which is the part that would have lost data.
    return NextResponse.json({
      models: scoped.models.map(toPopupModel),
      autoEnable: true,
      ...(scoped.degraded ? { degraded: true } : {}),
    });
  };
}

export const GET = createNewArrivalsGetHandler();

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
async function acknowledgeArrivals(
  deps: NewArrivalsDeps,
  userId: string,
  arrivals: NewModelArrival[]
): Promise<NextResponse> {
  const { degraded, error } = await deps.loadUserUsabilityScopes(userId);
  if (degraded || error) return okResponse();
  return (await advanceCursor(deps, userId, arrivals)) ?? okResponse();
}

export function createNewArrivalsPostHandler(
  overrides: Partial<NewArrivalsDeps> = {}
) {
  const deps: NewArrivalsDeps = { ...defaultNewArrivalsDeps, ...overrides };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: { action?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const action = body.action;
    if (action !== "dismiss" && action !== "disable") {
      return jsonError("action must be 'dismiss' or 'disable'", 400);
    }

    const loaded = await loadSettings(deps, userId);
    if ("error" in loaded) return loaded.error;

    const resolved = await resolveArrivalsOrError(
      deps,
      userId,
      loaded.settings
    );
    if ("error" in resolved) return resolved.error;
    const newModels = resolved.arrivals;

    if (action === "disable") {
      const failure = await applyDisableAction(deps, userId, newModels);
      if (failure) return failure;
    }

    return acknowledgeArrivals(deps, userId, newModels);
  };
}

function okResponse() {
  return NextResponse.json({ ok: true });
}

// Popup "stop auto-adding": flip the feature off first so that a later disable
// failure is lazily reconciled by the next GET (which now sees the flag off),
// then pin the currently-shown models to disabled.
async function applyDisableAction(
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

export const POST = createNewArrivalsPostHandler();

export function createNewArrivalsPatchHandler(
  overrides: Partial<NewArrivalsDeps> = {}
) {
  const deps: NewArrivalsDeps = { ...defaultNewArrivalsDeps, ...overrides };

  return async function PATCH(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: { autoEnable?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body.autoEnable !== "boolean") {
      return NextResponse.json(
        { error: "autoEnable must be a boolean" },
        { status: 400 }
      );
    }

    const { error } = await deps.setAutoEnableNewModels(
      userId,
      body.autoEnable
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  };
}

export const PATCH = createNewArrivalsPatchHandler();
