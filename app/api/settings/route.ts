import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import {
  canUserSetDefaultModel,
  resolveUserDefaultModelId,
} from "@/lib/models/default-model";
import { THEME_COOKIE_NAME, isThemePreference } from "@/lib/theme-preferences";

type SettingsGetDeps = {
  requireUserId: typeof requireUserId;
  loadProfile: (userId: string) => Promise<{
    data: { default_model: string | null; theme: string | null } | null;
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
};

const defaultSettingsGetDeps: SettingsGetDeps = {
  requireUserId,
  async loadProfile(userId) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("default_model, theme")
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
};

export function createSettingsGetHandler(
  overrides: Partial<SettingsGetDeps> = {}
) {
  const deps: SettingsGetDeps = {
    ...defaultSettingsGetDeps,
    ...overrides,
  };

  return async function GET() {
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

    const resolvedDefaultModel = await deps.resolveUserDefaultModelId(
      userId,
      data?.default_model
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

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (typeof body.default_model === "string") {
      const canSetDefaultModel = await deps.canUserSetDefaultModel(
        userId,
        body.default_model
      );
      if (!canSetDefaultModel) {
        return NextResponse.json(
          { error: "default_model must be enabled and available" },
          { status: 400 }
        );
      }
      updates.default_model = body.default_model;
    }
    if (isThemePreference(body.theme)) {
      updates.theme = body.theme;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }

    const { error } = await deps.updateProfile(userId, updates);

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const response = NextResponse.json({ ok: true });
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
