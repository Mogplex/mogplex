import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  isApiKeyAccess,
  type ApiKeyAccess,
} from "@/lib/mogplex-api/key-access";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ApiKeyDeleteDeps = {
  requireUserId: typeof requireUserId;
  revokeApiKey: (
    userId: string,
    keyId: string
  ) => Promise<{
    count: number | null;
    error: { message: string } | null;
  }>;
};

const defaultApiKeyDeleteDeps: ApiKeyDeleteDeps = {
  requireUserId,
  async revokeApiKey(userId, keyId) {
    const { count, error } = await supabaseAdmin
      .from("user_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .eq("user_id", userId)
      .is("revoked_at", null);

    return {
      count,
      error: error ? { message: error.message } : null,
    };
  },
};

export function createApiKeyDeleteHandler(
  overrides: Partial<ApiKeyDeleteDeps> = {}
) {
  const deps: ApiKeyDeleteDeps = {
    ...defaultApiKeyDeleteDeps,
    ...overrides,
  };

  return async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
    }

    const { count, error } = await deps.revokeApiKey(userId, id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (count === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  };
}

export const DELETE = createApiKeyDeleteHandler();

type ApiKeyPatchDeps = {
  requireUserId: typeof requireUserId;
  /** Resolves to the number of the caller's live keys it changed (0 or 1). */
  setApiKeyAccess: (
    userId: string,
    keyId: string,
    access: ApiKeyAccess
  ) => Promise<{
    updated: number;
    error: { message: string } | null;
  }>;
};

const defaultApiKeyPatchDeps: ApiKeyPatchDeps = {
  requireUserId,
  async setApiKeyAccess(userId, keyId, access) {
    const { data, error } = await supabaseAdmin
      .from("user_api_keys")
      .update({ access })
      .eq("id", keyId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .select("id");

    return {
      updated: (data ?? []).length,
      error: error ? { message: error.message } : null,
    };
  },
};

/**
 * Change what one of the caller's own keys may do. Only the key's owner can:
 * the update is filtered by their user id, so another account's key reads as
 * not found. The change applies to the key's next request and is logged
 * with the user, key, and new access.
 */
export function createApiKeyPatchHandler(
  overrides: Partial<ApiKeyPatchDeps> = {}
) {
  const deps: ApiKeyPatchDeps = {
    ...defaultApiKeyPatchDeps,
    ...overrides,
  };

  return async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
    }

    const body: unknown = await request.json().catch(() => null);
    const access =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).access
        : undefined;
    if (!isApiKeyAccess(access)) {
      return NextResponse.json(
        { error: "access must be 'full' or 'automations'" },
        { status: 400 }
      );
    }

    const { updated, error } = await deps.setApiKeyAccess(userId, id, access);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (updated === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // Personal keys have no team audit log, so the change is recorded here.
    console.info("[api-key-access] key access changed", {
      userId,
      keyId: id,
      access,
    });
    return NextResponse.json({ id, access });
  };
}

export const PATCH = createApiKeyPatchHandler();
