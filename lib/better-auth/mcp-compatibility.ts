import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { errors as joseErrors } from "jose";
import {
  isAPIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from "better-auth/api";
import {
  getOAuthProviderApi,
  type OAuthOptions,
} from "@better-auth/oauth-provider";
import {
  rememberIssuedAccessToken,
  requireStoredAccessToken,
} from "./mcp-token-store";

function requestClientId(ctx: GenericEndpointContext) {
  const body = ctx.body as { client_id?: unknown } | undefined;
  const candidate = body?.client_id ?? ctx.query?.client_id;
  if (typeof candidate === "string") return candidate;
  const authorization = ctx.headers?.get("authorization");
  if (!authorization?.match(/^Basic /i)) return null;
  try {
    return decodeURIComponent(
      Buffer.from(authorization.slice(6), "base64")
        .toString("utf8")
        .split(":", 1)[0]
    );
  } catch {
    return null;
  }
}

async function prepareResource(ctx: GenericEndpointContext, resource: string) {
  const where = [{ field: "identifier", value: resource }];
  if (await ctx.context.adapter.findOne({ model: "oauthResource", where }))
    return;
  try {
    const now = new Date();
    await ctx.context.adapter.create({
      model: "oauthResource",
      data: {
        identifier: resource,
        name: "Mogplex API",
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    if (!(await ctx.context.adapter.findOne({ model: "oauthResource", where })))
      throw error;
  }
}

async function linkRegisteredClient(
  ctx: GenericEndpointContext,
  resource: string
) {
  await prepareResource(ctx, resource);
  const clientId = requestClientId(ctx);
  if (!clientId) return;
  const client = await ctx.context.adapter.findOne<{ disabled?: boolean }>({
    model: "oauthClient",
    where: [{ field: "clientId", value: clientId }],
  });
  if (!client || client.disabled) return;
  const where = [
    { field: "clientId", value: clientId },
    { field: "resourceId", value: resource },
  ];
  if (
    await ctx.context.adapter.findOne({ model: "oauthClientResource", where })
  )
    return;
  try {
    await ctx.context.adapter.create({
      model: "oauthClientResource",
      data: { clientId, resourceId: resource },
    });
  } catch (error) {
    // Another request may have created the same unique client/resource link.
    if (
      !(await ctx.context.adapter.findOne({
        model: "oauthClientResource",
        where,
      }))
    )
      throw error;
  }
}

/** Preserve the bearer-session API while the provider moves to OAuth 2.1. */
export function legacyMcpCompatibility(
  options: OAuthOptions<string[]>,
  resource: string
) {
  return {
    id: "mogplex-mcp-compatibility",
    schema: {
      oauthClient: {
        fields: {
          legacySecretMethods: {
            type: "boolean",
            required: false,
            defaultValue: false,
            input: false,
          },
        },
      },
      oauthAccessToken: {
        modelName: "oauthAccessTokenV2",
        fields: {
          legacyOpaque: {
            type: "boolean",
            required: false,
            defaultValue: false,
            input: false,
          },
        },
      },
    },
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path === "/oauth2/authorize" ||
            ctx.path === "/oauth2/token" ||
            ctx.path === "/oauth2/register",
          handler: createAuthMiddleware((ctx) =>
            linkRegisteredClient(ctx, resource)
          ),
        },
        {
          matcher: (ctx) => ctx.path === "/oauth2/userinfo",
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { access_token?: unknown } | undefined;
            const token =
              ctx.headers
                ?.get("authorization")
                ?.match(/^(?:Bearer|DPoP) (.+)$/i)?.[1] ?? body?.access_token;
            if (typeof token === "string")
              await requireStoredAccessToken(ctx, options, token);
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/token",
          handler: createAuthMiddleware((ctx) =>
            rememberIssuedAccessToken(ctx, options, ctx.context.returned)
          ),
        },
      ],
    },
    endpoints: {
      getMcpSession: createAuthEndpoint(
        "/mcp/get-session",
        { method: "GET", requireHeaders: true },
        async (ctx) => {
          const authorization = ctx.headers.get("authorization");
          const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
          if (!token) return null;
          try {
            const payload = await getOAuthProviderApi(
              ctx,
              options
            ).requireActiveAccessToken(token);
            const record = await requireStoredAccessToken(ctx, options, token);
            const clientId = payload.client_id ?? payload.azp;
            if (
              typeof payload.sub !== "string" ||
              typeof clientId !== "string" ||
              payload.cnf
            )
              return null;
            const audiences =
              typeof payload.aud === "string" ? [payload.aud] : payload.aud;
            if (audiences?.length) {
              if (!audiences.includes(resource)) return null;
            } else if (!record.legacyOpaque) {
              // The migration marks known pre-cutover opaque credentials.
              return null;
            }
            const scopes =
              typeof payload.scope === "string"
                ? payload.scope
                    .split(/\s+/)
                    .filter((scope) => record.scopes.includes(scope))
                    .join(" ")
                : "";
            return { clientId, userId: payload.sub, scopes };
          } catch (error) {
            if (error instanceof joseErrors.JOSEError) return null;
            if (
              isAPIError(error) &&
              (error.status === "UNAUTHORIZED" ||
                error.status === "BAD_REQUEST")
            )
              return null;
            throw error;
          }
        }
      ),
    },
  } satisfies BetterAuthPlugin;
}
