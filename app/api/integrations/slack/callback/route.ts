import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAppUrl } from "@/lib/app-url";
import {
  exchangeSlackCode,
  getSlackOAuthConfig,
  verifySlackOAuthState,
  type SlackOAuthAccessResponse,
  type SlackOAuthConfig,
  type SlackOAuthStatePayload,
  SLACK_OAUTH_STATE_COOKIE,
} from "@/lib/slack/oauth";
import {
  upsertSlackInstallation,
  type UpsertSlackInstallationInput,
} from "@/lib/slack/installations";

function settingsRedirect(request: Request, query: string) {
  return NextResponse.redirect(buildAppUrl(`/settings?${query}`, request));
}

type ValidatedCallbackInputs = {
  code: string;
  config: SlackOAuthConfig;
  verified: SlackOAuthStatePayload;
};

/** Minimal cookie-store surface the callback handler relies on. */
export type SlackCallbackCookieStore = {
  get: (name: string) => { value: string } | undefined;
  delete: (options: { name: string; path: string }) => unknown;
};

/**
 * Injectable dependencies for the OAuth callback handler. Defaults wire up the
 * real Next.js cookie store, env-backed config, and Supabase-backed persistence;
 * tests override them to exercise the branches in isolation.
 */
export type SlackCallbackDeps = {
  getCookieStore: () => Promise<SlackCallbackCookieStore>;
  getOAuthConfig: (request: Request) => SlackOAuthConfig | null;
  exchangeCode: (input: {
    code: string;
    config: SlackOAuthConfig;
  }) => Promise<SlackOAuthAccessResponse>;
  upsertInstallation: (input: UpsertSlackInstallationInput) => Promise<unknown>;
};

const defaultDeps: SlackCallbackDeps = {
  getCookieStore: () => cookies(),
  getOAuthConfig: (request) => getSlackOAuthConfig(request),
  exchangeCode: (input) => exchangeSlackCode(input),
  upsertInstallation: (input) => upsertSlackInstallation(input),
};

export function deleteSlackOAuthStateCookie(cookieStore: {
  delete: (options: { name: string; path: string }) => unknown;
}) {
  cookieStore.delete({ name: SLACK_OAUTH_STATE_COOKIE, path: "/" });
}

/**
 * Validate the callback's query params, signed state, cookie nonce, and Slack
 * OAuth config. Either returns the inputs we need to exchange the code or an
 * error redirect that the GET handler should return directly.
 */
async function validateSlackCallback(
  request: Request,
  deps: SlackCallbackDeps
): Promise<ValidatedCallbackInputs | NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const slackError = searchParams.get("error");

  const cookieStore = await deps.getCookieStore();
  const cookieNonce = cookieStore.get(SLACK_OAUTH_STATE_COOKIE)?.value ?? null;
  // Clear the cookie regardless of outcome — it's single-use.
  deleteSlackOAuthStateCookie(cookieStore);

  if (slackError) {
    console.warn("[slack-callback] user-aborted or Slack returned error", {
      slackError,
    });
    return settingsRedirect(
      request,
      `slack=denied&reason=${encodeURIComponent(slackError)}`
    );
  }
  if (!code || !state) {
    return settingsRedirect(request, "slack=error&reason=missing_params");
  }

  const config = deps.getOAuthConfig(request);
  if (!config) {
    return settingsRedirect(request, "slack=not_configured");
  }

  const verified = verifySlackOAuthState(state, config.signingSecret);
  if (!verified) {
    return settingsRedirect(request, "slack=error&reason=invalid_state");
  }
  // Defense-in-depth: the signed state binds to the original user, and the
  // cookie nonce binds to the original browser session. Mismatched cookie means
  // the redirect was likely replayed in a different context.
  if (!cookieNonce || cookieNonce !== verified.nonce) {
    return settingsRedirect(request, "slack=error&reason=nonce_mismatch");
  }

  return { code, config, verified };
}

function isSuccessfulExchange(
  exchange: SlackOAuthAccessResponse
): exchange is SlackOAuthAccessResponse & {
  access_token: string;
  bot_user_id: string;
  team: { id: string; name?: string };
} {
  return Boolean(
    exchange.ok &&
    exchange.access_token &&
    exchange.team?.id &&
    exchange.bot_user_id
  );
}

function parseScopeList(scope: string | undefined): string[] {
  return (scope ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build the Slack OAuth callback GET handler. Exported as a factory so tests can
 * inject fakes for the cookie store, config, code exchange, and persistence.
 */
export function createSlackCallbackGetHandler(
  overrides: Partial<SlackCallbackDeps> = {}
) {
  const deps: SlackCallbackDeps = { ...defaultDeps, ...overrides };

  return async function GET(request: Request) {
    const validated = await validateSlackCallback(request, deps);
    if (validated instanceof NextResponse) return validated;

    const { code, config, verified } = validated;
    const exchange = await deps.exchangeCode({ code, config });

    if (!isSuccessfulExchange(exchange)) {
      console.error("[slack-callback] oauth.v2.access returned failure", {
        error: exchange.error,
        teamId: exchange.team?.id,
      });
      return settingsRedirect(
        request,
        `slack=error&reason=${encodeURIComponent(
          exchange.error ?? "exchange_failed"
        )}`
      );
    }

    try {
      await deps.upsertInstallation({
        teamId: exchange.team.id,
        teamName: exchange.team.name ?? null,
        installedByUserId: verified.userId,
        botUserId: exchange.bot_user_id,
        botToken: exchange.access_token,
        scopes: parseScopeList(exchange.scope),
        authedUserSlackId: exchange.authed_user?.id ?? null,
      });
    } catch (error) {
      console.error("[slack-callback] failed to persist installation", error);
      return settingsRedirect(request, "slack=error&reason=persist_failed");
    }

    return settingsRedirect(
      request,
      `slack=connected&team=${encodeURIComponent(exchange.team.id)}`
    );
  };
}

export const GET = createSlackCallbackGetHandler();
