import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { ApiKeyResolution } from "@/lib/auth/api-key";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getMogplexMcpResourceUrl,
  getSupabaseOAuthIssuer,
  getSupabaseOAuthJwksUrl,
} from "@/lib/mogplex-api/oauth-config";

type MogplexOAuthVerifierDependencies = {
  verifyJwt: typeof jwtVerify;
  getVerificationKey: () => JWTVerifyGetKey;
  isClientAllowed: (clientId: string) => Promise<boolean>;
  resolveProfileId: (authUserId: string) => Promise<string | null>;
};

let remoteJwks: JWTVerifyGetKey | null = null;

function getVerificationKey() {
  remoteJwks ??= createRemoteJWKSet(new URL(getSupabaseOAuthJwksUrl()));
  return remoteJwks;
}

async function isClientAllowed(clientId: string) {
  const { data, error } = await supabaseAdmin
    .from("mcp_oauth_clients")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle();
  return !error && Boolean(data);
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
  verifyJwt: jwtVerify,
  getVerificationKey,
  isClientAllowed,
  resolveProfileId,
};

let dependencies = defaultDependencies;

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
    const { payload } = await dependencies.verifyJwt(
      token,
      dependencies.getVerificationKey(),
      {
        issuer: getSupabaseOAuthIssuer(),
        audience: getMogplexMcpResourceUrl(),
      }
    );
    const authUserId = payload.sub;
    const clientId =
      typeof payload.client_id === "string"
        ? payload.client_id
        : typeof payload.azp === "string"
          ? payload.azp
          : null;

    if (!authUserId || !clientId || typeof payload.exp !== "number") {
      return { ok: false, reason: "invalid" };
    }
    if (!(await dependencies.isClientAllowed(clientId))) {
      return { ok: false, reason: "invalid" };
    }

    const profileId = await dependencies.resolveProfileId(authUserId);
    if (!profileId) return { ok: false, reason: "invalid" };

    return {
      ok: true,
      auth: {
        userId: profileId,
        keyId: clientId,
        scopes: ["read", "write"],
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
  remoteJwks = null;
}
