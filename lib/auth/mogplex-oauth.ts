import type { ApiKeyResolution } from "@/lib/auth/api-key";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MOGPLEX_OAUTH_SCOPES = ["read", "write"] as const;
type MogplexOAuthScope = (typeof MOGPLEX_OAUTH_SCOPES)[number];

type BetterAuthMcpSession = {
  clientId?: string | null;
  userId?: string | null;
  scopes?: string | null;
};

type MogplexOAuthVerifierDependencies = {
  getMcpSession: (
    authorization: string
  ) => Promise<BetterAuthMcpSession | null>;
  resolveProfileId: (authUserId: string) => Promise<string | null>;
};

async function getMcpSession(authorization: string) {
  const { auth } = await import("@/lib/better-auth/server");
  return auth.api.getMcpSession({
    headers: new Headers({ authorization }),
  });
}

async function resolveProfileId(authUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error || !data?.id) return null;
  return data.id as string;
}

const defaultDependencies: MogplexOAuthVerifierDependencies = {
  getMcpSession,
  resolveProfileId,
};

let dependencies = defaultDependencies;

function isMogplexOAuthScope(value: string): value is MogplexOAuthScope {
  return (MOGPLEX_OAUTH_SCOPES as readonly string[]).includes(value);
}

function parseMcpSession(session: BetterAuthMcpSession | null) {
  if (!session?.userId || !session.clientId) return null;

  const scopes = (session.scopes ?? "")
    .split(/\s+/)
    .filter(isMogplexOAuthScope);
  if (scopes.length === 0) return null;

  return {
    authUserId: session.userId,
    clientId: session.clientId,
    scopes,
  };
}

export async function resolveMogplexOAuthToken(
  authorization: string | null
): Promise<ApiKeyResolution> {
  if (!authorization?.startsWith("Bearer ")) {
    return { ok: false, reason: "invalid" };
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token || token.startsWith("mog_")) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const session = await dependencies.getMcpSession(authorization);
    const parsed = parseMcpSession(session);
    if (!parsed) return { ok: false, reason: "invalid" };

    const profileId = await dependencies.resolveProfileId(parsed.authUserId);
    if (!profileId) return { ok: false, reason: "invalid" };

    return {
      ok: true,
      auth: {
        userId: profileId,
        keyId: parsed.clientId,
        scopes: parsed.scopes,
      },
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function __setMogplexOAuthVerifierDependenciesForTesting(
  overrides: Partial<MogplexOAuthVerifierDependencies>
) {
  dependencies = { ...defaultDependencies, ...overrides };
}

export function __resetMogplexOAuthVerifierForTesting() {
  dependencies = defaultDependencies;
}
