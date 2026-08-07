import { NextResponse } from "next/server";

import { defaultNewArrivalsDeps, type NewArrivalsDeps } from "./_lib/deps";
import {
  jsonError,
  okResponse,
  resolveArrivalsOrError,
  scopeArrivalsForPopup,
  toPopupModel,
  loadSettings,
  reconcileFeatureOff,
  acknowledgeArrivals,
  applyDisableAction,
} from "./_lib/handlers";

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

    return okResponse();
  };
}

export const PATCH = createNewArrivalsPatchHandler();
