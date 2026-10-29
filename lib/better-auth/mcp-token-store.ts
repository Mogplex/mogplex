import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import {
  getOAuthProviderApi,
  type OAuthOptions,
} from "@better-auth/oauth-provider";

type AccessRecord = {
  clientId: string;
  userId: string | null;
  scopes: string[];
  expiresAt: Date;
  revoked?: Date | null;
  legacyOpaque?: boolean;
};

/** JWT signatures remain provider-owned; this record preserves immediate revocation. */
export async function storedAccessToken(
  ctx: GenericEndpointContext,
  options: OAuthOptions<string[]>,
  token: string
) {
  return ctx.context.adapter.findOne<AccessRecord>({
    model: "oauthAccessToken",
    where: [
      {
        field: "token",
        value: await getOAuthProviderApi(ctx, options).hashToken(
          token,
          "access_token"
        ),
      },
    ],
  });
}

export async function requireStoredAccessToken(
  ctx: GenericEndpointContext,
  options: OAuthOptions<string[]>,
  token: string
) {
  const record = await storedAccessToken(ctx, options, token);
  if (!record || record.revoked || record.expiresAt <= new Date()) {
    throw new APIError("UNAUTHORIZED", { error: "invalid_token" });
  }
  return record;
}

async function tokenResponse(
  value: unknown
): Promise<Record<string, unknown> | null> {
  if (value instanceof Response) {
    try {
      return await value.clone().json();
    } catch {
      return null;
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export async function rememberIssuedAccessToken(
  ctx: GenericEndpointContext,
  options: OAuthOptions<string[]>,
  returned: unknown
) {
  const response = await tokenResponse(returned);
  const token = response?.access_token;
  if (typeof token !== "string") return;
  if (await storedAccessToken(ctx, options, token)) return;
  const provider = getOAuthProviderApi(ctx, options);
  const payload = await provider.requireActiveAccessToken(token);
  const clientId = payload.client_id ?? payload.azp;
  if (
    typeof payload.sub !== "string" ||
    typeof clientId !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number"
  ) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      error: "invalid_issued_token",
    });
  }
  const body = ctx.body as
    | { code?: unknown; refresh_token?: unknown }
    | undefined;
  const refreshToken =
    typeof response?.refresh_token === "string"
      ? response.refresh_token
      : body?.refresh_token;
  const refresh =
    typeof refreshToken === "string"
      ? await ctx.context.adapter.findOne<{
          id: string;
          authorizationCodeId?: string | null;
          sessionId?: string | null;
        }>({
          model: "oauthRefreshToken",
          where: [
            {
              field: "token",
              value: await provider.hashToken(refreshToken, "refresh_token"),
            },
          ],
        })
      : null;
  const audiences =
    typeof payload.aud === "string" ? [payload.aud] : payload.aud;
  const authorizationCodeId =
    refresh?.authorizationCodeId ??
    (typeof body?.code === "string"
      ? await provider.hashToken(body.code, "authorization_code")
      : null);
  try {
    await ctx.context.adapter.create({
      model: "oauthAccessToken",
      data: {
        token: await provider.hashToken(token, "access_token"),
        clientId,
        userId: payload.sub,
        scopes:
          typeof payload.scope === "string"
            ? payload.scope.split(/\s+/).filter(Boolean)
            : [],
        resources: audiences ?? null,
        refreshId: refresh?.id ?? null,
        sessionId: refresh?.sessionId ?? null,
        authorizationCodeId,
        expiresAt: new Date(payload.exp * 1000),
        createdAt: new Date(payload.iat * 1000),
      },
    });
  } catch (error) {
    // A retried/concurrent refresh may replay the same issued response.
    if (!(await storedAccessToken(ctx, options, token))) throw error;
  }
}
