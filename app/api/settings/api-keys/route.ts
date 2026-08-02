import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { generateApiToken } from "@/lib/auth/api-key";
import {
  isMogplexApiScope,
  MOGPLEX_API_SCOPES,
  type MogplexApiScope,
} from "@/lib/mogplex-api/scopes";
import { supabaseAdmin } from "@/lib/supabase/admin";

const DEFAULT_API_KEY_SCOPES: MogplexApiScope[] = ["read", "write"];

/**
 * Validate the optional `scopes` field on the create-PAT request body.
 *
 * Returns either a parsed scope list or a NextResponse for the caller to
 * return directly. Rules:
 *   - Omitted/null/undefined → use DEFAULT_API_KEY_SCOPES.
 *   - Empty array → 400 ("at least one scope is required"). A zero-scope
 *     token is meaningless and the most likely cause is a UI bug.
 *   - Non-array → 400.
 *   - Unknown scope strings → 400 listing the allowed set. The offending
 *     value is NOT echoed back — keeps logs clean and avoids a reflected-
 *     input pattern that could be copied into an HTML-rendering context.
 *   - Duplicates → deduped silently. Defensive — UIs sometimes send
 *     ['read', 'read'].
 */
function parseScopesInput(
  input: unknown
):
  | { ok: true; scopes: MogplexApiScope[] }
  | { ok: false; response: NextResponse } {
  if (input === undefined || input === null) {
    return { ok: true, scopes: [...DEFAULT_API_KEY_SCOPES] };
  }
  if (!Array.isArray(input)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "scopes must be an array of strings" },
        { status: 400 }
      ),
    };
  }
  if (input.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "scopes must include at least one entry" },
        { status: 400 }
      ),
    };
  }
  const seen = new Set<MogplexApiScope>();
  for (const value of input) {
    if (!isMogplexApiScope(value)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: `Invalid scope value. Allowed: ${MOGPLEX_API_SCOPES.join(", ")}.`,
          },
          { status: 400 }
        ),
      };
    }
    seen.add(value);
  }
  return { ok: true, scopes: [...seen] };
}

type ApiKeyRow = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

type ApiKeysDeps = {
  requireUserId: typeof requireUserId;
  listApiKeys: (userId: string) => Promise<{
    data: ApiKeyRow[] | null;
    error: { message: string } | null;
  }>;
  createApiKey: (input: {
    userId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    scopes: string[];
    expiresAt: string | null;
  }) => Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>;
  generateApiToken: typeof generateApiToken;
};

const defaultApiKeysDeps: ApiKeysDeps = {
  requireUserId,
  generateApiToken,
  async listApiKeys(userId) {
    const { data, error } = await supabaseAdmin
      .from("user_api_keys")
      .select(
        "id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at"
      )
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    return {
      data,
      error: error ? { message: error.message } : null,
    };
  },
  async createApiKey(input) {
    const { data, error } = await supabaseAdmin
      .from("user_api_keys")
      .insert({
        user_id: input.userId,
        name: input.name,
        token_hash: input.tokenHash,
        token_prefix: input.tokenPrefix,
        scopes: input.scopes,
        expires_at: input.expiresAt,
      })
      .select("id")
      .single();

    return {
      data,
      error: error ? { message: error.message } : null,
    };
  },
};

export function createApiKeysGetHandler(overrides: Partial<ApiKeysDeps> = {}) {
  const deps: ApiKeysDeps = {
    ...defaultApiKeysDeps,
    ...overrides,
  };

  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { data, error } = await deps.listApiKeys(userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      keys: (data ?? []).map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.token_prefix,
        scopes: key.scopes,
        createdAt: key.created_at,
        lastUsedAt: key.last_used_at,
        expiresAt: key.expires_at,
      })),
    });
  };
}

export const GET = createApiKeysGetHandler();

export function createApiKeysPostHandler(overrides: Partial<ApiKeysDeps> = {}) {
  const deps: ApiKeysDeps = {
    ...defaultApiKeysDeps,
    ...overrides,
  };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: { name?: string; expiresInDays?: number; scopes?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length === 0 || name.length > 100) {
      return NextResponse.json(
        { error: "Name is required (1-100 characters)" },
        { status: 400 }
      );
    }

    const parsedScopes = parseScopesInput(body.scopes);
    if (!parsedScopes.ok) return parsedScopes.response;

    const expiresInDays =
      typeof body.expiresInDays === "number" && body.expiresInDays > 0
        ? body.expiresInDays
        : null;

    let expiresAt: string | null = null;
    if (expiresInDays) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + expiresInDays);
      expiresAt = expiry.toISOString();
    }

    const { token, hash, prefix } = deps.generateApiToken();

    const { data, error } = await deps.createApiKey({
      userId,
      name,
      tokenHash: hash,
      tokenPrefix: prefix,
      scopes: parsedScopes.scopes,
      expiresAt,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return the plaintext token only this once
    return NextResponse.json({
      id: data?.id,
      token,
      prefix,
      scopes: parsedScopes.scopes,
      expiresAt,
    });
  };
}

export const POST = createApiKeysPostHandler();
