import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import {
  canUserSetDefaultModel,
  resolveUserDefaultModelId,
} from "@/lib/models/default-model";
import {
  applyModelDefaults,
  ModelSettingsError,
} from "@/lib/models/settings-defaults";
import {
  isModelSurface,
  surfaceDefaultModel,
} from "@/lib/models/surface-defaults";
import { THEME_COOKIE_NAME, isThemePreference } from "@/lib/theme-preferences";

type SettingsGetDeps = {
  requireUserId: typeof requireUserId;
  loadProfile: (userId: string) => Promise<{
    data: {
      default_model: string | null;
      theme: string | null;
      surface_models?: unknown;
    } | null;
    error: { code?: string; message: string } | null;
  }>;
  resolveUserDefaultModelId: typeof resolveUserDefaultModelId;
};

type SettingsPatchDeps = {
  requireUserId: typeof requireUserId;
  canUserSetDefaultModel: typeof canUserSetDefaultModel;
  updateProfile: (
    userId: string,
    updates: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  applyModelDefaults: typeof applyModelDefaults;
};

const defaultSettingsGetDeps: SettingsGetDeps = {
  requireUserId,
  async loadProfile(userId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("default_model, theme, surface_models")
      .eq("id", userId)
      .single();

    return {
      data,
      error: error ? { code: error.code, message: error.message } : null,
    };
  },
  resolveUserDefaultModelId,
};

const defaultSettingsPatchDeps: SettingsPatchDeps = {
  requireUserId,
  canUserSetDefaultModel,
  async updateProfile(userId, updates) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", userId);

    return {
      error: error ? { message: error.message } : null,
    };
  },
  applyModelDefaults,
};

export function createSettingsGetHandler(
  overrides: Partial<SettingsGetDeps> = {}
) {
  const deps: SettingsGetDeps = {
    ...defaultSettingsGetDeps,
    ...overrides,
  };

  return async function GET(request?: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { data, error } = await deps.loadProfile(userId);

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Profile not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const requestedSurface = request
      ? new URL(request.url).searchParams.get("surface")
      : null;
    // Released CLI clients bootstrap from this endpoint using bearer auth,
    // then send the returned model explicitly on every inference request.
    const surface = isModelSurface(requestedSurface)
      ? requestedSurface
      : request?.headers.get("authorization")?.startsWith("Bearer ")
        ? "cli"
        : undefined;
    const resolvedDefaultModel = await deps.resolveUserDefaultModelId(
      userId,
      surfaceDefaultModel(data, surface)
    );
    const payload = {
      ...data,
      default_model: resolvedDefaultModel,
    };

    const response = NextResponse.json(payload);
    if (isThemePreference(data?.theme)) {
      response.cookies.set(THEME_COOKIE_NAME, data.theme, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  };
}

export const GET = createSettingsGetHandler();

export function createSettingsPatchHandler(
  overrides: Partial<SettingsPatchDeps> = {}
) {
  const deps: SettingsPatchDeps = {
    ...defaultSettingsPatchDeps,
    ...overrides,
  };

  return async function PATCH(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
    const fields = body as Record<string, unknown>;
    if (fields.update_automation_models === true) {
      return NextResponse.json(
        {
          error:
            "Reload settings to choose which automations receive this model.",
        },
        { status: 409 }
      );
    }
    const surfaces = fields.apply_to_surfaces ?? [];
    const flowIds = fields.automation_ids ?? [];
    if (
      !Array.isArray(surfaces) ||
      !surfaces.every(isModelSurface) ||
      !Array.isArray(flowIds) ||
      !flowIds.every(
        (id) =>
          typeof id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            id
          )
      )
    ) {
      return NextResponse.json(
        { error: "Invalid model destinations" },
        { status: 400 }
      );
    }
    const updates: Record<string, unknown> = {};

    if (typeof fields.default_model === "string") {
      const canSetDefaultModel = await deps.canUserSetDefaultModel(
        userId,
        fields.default_model
      );
      if (!canSetDefaultModel) {
        return NextResponse.json(
          { error: "default_model must be enabled and available" },
          { status: 400 }
        );
      }
      updates.default_model = fields.default_model;
    }
    if (isThemePreference(fields.theme)) {
      updates.theme = fields.theme;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    let automations:
      | { drafts_updated: number; versions_published: number }
      | undefined;
    try {
      if (typeof updates.default_model === "string") {
        automations = await deps.applyModelDefaults({
          userId,
          model: updates.default_model,
          surfaces: [...new Set(surfaces)],
          flowIds: [...new Set(flowIds)],
          ...(typeof updates.theme === "string"
            ? { theme: updates.theme }
            : {}),
        });
      } else {
        const { error } = await deps.updateProfile(userId, updates);
        if (error)
          return NextResponse.json(
            { error: "Unable to save settings" },
            { status: 500 }
          );
      }
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof ModelSettingsError
              ? error.message
              : "Unable to save model settings. No changes were applied.",
        },
        { status: error instanceof ModelSettingsError ? error.status : 500 }
      );
    }
    const response = NextResponse.json({
      ok: true,
      ...(automations ? { automations } : {}),
    });
    if (isThemePreference(updates.theme)) {
      response.cookies.set(THEME_COOKIE_NAME, updates.theme, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  };
}

export const PATCH = createSettingsPatchHandler();
