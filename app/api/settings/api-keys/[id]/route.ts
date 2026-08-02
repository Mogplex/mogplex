import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
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
