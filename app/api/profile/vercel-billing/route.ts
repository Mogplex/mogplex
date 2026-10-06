import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";

type PatchBody = {
  projectId?: unknown;
  teamId?: unknown;
};

type ProfileVercelBillingDeps = {
  requireUserId: typeof requireUserId;
  updateProfile: (
    userId: string,
    updates: {
      default_vercel_project_id: string | null;
      default_vercel_team_id: string | null;
    }
  ) => Promise<{ error: { message: string } | null }>;
};

const defaultDeps: ProfileVercelBillingDeps = {
  requireUserId,
  async updateProfile(userId, updates) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", userId);

    return { error: error ? { message: error.message } : null };
  },
};

type ProjectIdInput =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

function parseProjectIdInput(value: unknown): ProjectIdInput {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "projectId must be a string or null" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "projectId must be a non-empty string or null" };
  }
  return { ok: true, value: trimmed };
}

export function createProfileVercelBillingPatchHandler(
  overrides: Partial<ProfileVercelBillingDeps> = {}
) {
  const deps: ProfileVercelBillingDeps = { ...defaultDeps, ...overrides };

  return async function PATCH(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: PatchBody;
    try {
      const raw = await request.json();
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return NextResponse.json(
          { error: "Body must be a JSON object" },
          { status: 400 }
        );
      }
      body = raw as PatchBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!("projectId" in body)) {
      return NextResponse.json(
        { error: "projectId is required (use null to clear)" },
        { status: 400 }
      );
    }

    const parsedProjectId = parseProjectIdInput(body.projectId);
    if (!parsedProjectId.ok) {
      return NextResponse.json(
        { error: parsedProjectId.error },
        { status: 400 }
      );
    }
    const projectId = parsedProjectId.value;

    if (projectId === null) {
      // Intentional: clearing the user's own default does not require a live
      // Vercel token. A user who disconnected Vercel still needs to be able
      // to remove a stale default they set while connected.
      const { error } = await deps.updateProfile(userId, {
        default_vercel_project_id: null,
        default_vercel_team_id: null,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        projectId: null,
        teamId: null,
        projectName: null,
      });
    }

    // Retained only so existing clients can clear obsolete account defaults.
    return NextResponse.json(
      {
        error: "VERCEL_INTEGRATION_REQUIRED",
        message:
          "User-owned Vercel billing requires an API-capable Vercel integration and is not available.",
      },
      { status: 501 }
    );
  };
}

export const PATCH = createProfileVercelBillingPatchHandler();
