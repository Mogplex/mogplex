import { createHmac, timingSafeEqual } from "node:crypto";

const PIPEDREAM_API_BASE_URL = "https://api.pipedream.com";
const DEFAULT_SENTRY_APP_SLUG = "sentry";
const WEBHOOK_TOLERANCE_SECONDS = 300;

type PipedreamProjectEnvironment = "development" | "production";

type PipedreamConfig = {
  clientId: string;
  clientSecret: string;
  projectId: string;
  projectEnvironment: PipedreamProjectEnvironment;
  webhookSigningKey: string;
  sentryAppSlug: string;
};

type PipedreamServerTokenResponse = {
  access_token: string;
};

type PipedreamConnectTokenResponse = {
  token: string;
  expires_at: string;
  connect_link_url: string;
};

type PipedreamAccountCredentials = {
  oauth_access_token?: string;
  oauth_refresh_token?: string;
  oauth_client_id?: string;
  oauth_uid?: string;
  oauth_signer_uri?: string;
  [key: string]: unknown;
};

export type PipedreamAccount = {
  id: string;
  name: string | null;
  external_id: string;
  healthy: boolean;
  dead: boolean | null;
  app: {
    id?: string;
    name_slug: string;
    name: string;
    auth_type?: string;
  };
  created_at: string;
  updated_at: string;
  authorized_scopes?: string[];
  credentials?: PipedreamAccountCredentials;
  expires_at?: string | null;
  error?: string | null;
};

export type PipedreamConnectionWebhookPayload = {
  event: "CONNECTION_SUCCESS" | "CONNECTION_ERROR";
  environment: PipedreamProjectEnvironment;
  connect_token: string;
  connect_session_id: number;
  account?: {
    id: string;
    external_id: string;
    healthy: boolean;
    dead: boolean | null;
    app: {
      id?: string;
      name_slug: string;
      name: string;
      auth_type?: string;
    };
    created_at: string;
    updated_at: string;
  };
  error?: string;
};

export type PipedreamManagedAuthCredentials = {
  kind: "pipedream_connect";
  provider: "sentry";
  account_id: string;
  app_slug: string;
  account_name: string | null;
  external_user_id: string;
  authorized_scopes: string[] | null;
  connected_at: string;
  expires_at: string | null;
};

export class PipedreamConnectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipedreamConnectConfigError";
  }
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PipedreamConnectConfigError(
      `${name} is required for Sentry managed auth`
    );
  }
  return value;
}

function getPipedreamConfig(): PipedreamConfig {
  const projectEnvironment = getRequiredEnv(
    "PIPEDREAM_PROJECT_ENVIRONMENT"
  ) as PipedreamProjectEnvironment;
  if (
    projectEnvironment !== "development" &&
    projectEnvironment !== "production"
  ) {
    throw new PipedreamConnectConfigError(
      "PIPEDREAM_PROJECT_ENVIRONMENT must be development or production"
    );
  }

  return {
    clientId: getRequiredEnv("PIPEDREAM_CLIENT_ID"),
    clientSecret: getRequiredEnv("PIPEDREAM_CLIENT_SECRET"),
    projectId: getRequiredEnv("PIPEDREAM_PROJECT_ID"),
    projectEnvironment,
    webhookSigningKey: getRequiredEnv("PIPEDREAM_CONNECT_WEBHOOK_SIGNING_KEY"),
    sentryAppSlug:
      process.env.PIPEDREAM_SENTRY_APP_SLUG?.trim() || DEFAULT_SENTRY_APP_SLUG,
  };
}

function encodeQueryParam(value: boolean) {
  return value ? "true" : "false";
}

async function getPipedreamServerAccessToken(scope: string) {
  const config = getPipedreamConfig();
  const response = await fetch(`${PIPEDREAM_API_BASE_URL}/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Pipedream OAuth token request failed (${response.status})`
    );
  }

  const payload =
    (await response.json()) as Partial<PipedreamServerTokenResponse>;
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error(
      "Pipedream OAuth token response did not include access_token"
    );
  }

  return payload.access_token;
}

async function pipedreamFetchJson<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    scope: string;
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const config = getPipedreamConfig();
  const accessToken = await getPipedreamServerAccessToken(options.scope);
  const response = await fetch(`${PIPEDREAM_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-pd-environment": config.projectEnvironment,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Pipedream Connect request failed (${response.status})${message ? `: ${message}` : ""}`
    );
  }

  return (await response.json()) as T;
}

export function getPipedreamSentryAppSlug() {
  return getPipedreamConfig().sentryAppSlug;
}

export async function createSentryConnectLink(input: {
  externalUserId: string;
  successRedirectUri: string;
  errorRedirectUri: string;
  webhookUri: string;
}) {
  const config = getPipedreamConfig();
  const payload = await pipedreamFetchJson<PipedreamConnectTokenResponse>(
    `/v1/connect/${config.projectId}/tokens`,
    {
      method: "POST",
      scope: "connect:tokens:create",
      body: {
        external_user_id: input.externalUserId,
        success_redirect_uri: input.successRedirectUri,
        error_redirect_uri: input.errorRedirectUri,
        webhook_uri: input.webhookUri,
        scope: "connect:accounts:read connect:accounts:write",
      },
    }
  );

  if (
    typeof payload.connect_link_url !== "string" ||
    !payload.connect_link_url ||
    typeof payload.token !== "string" ||
    !payload.token
  ) {
    throw new Error("Pipedream Connect token response was incomplete");
  }

  const connectLink = new URL(payload.connect_link_url);
  connectLink.searchParams.set("app", config.sentryAppSlug);
  connectLink.searchParams.set("connectLink", encodeQueryParam(true));

  return {
    connectLinkUrl: connectLink.toString(),
    expiresAt: payload.expires_at,
    token: payload.token,
  };
}

export async function retrievePipedreamAccount(
  accountId: string,
  options?: { includeCredentials?: boolean }
) {
  const config = getPipedreamConfig();
  const includeCredentials = Boolean(options?.includeCredentials);
  const searchParams = new URLSearchParams({
    include_credentials: encodeQueryParam(includeCredentials),
  });
  return pipedreamFetchJson<PipedreamAccount>(
    `/v1/connect/${config.projectId}/accounts/${encodeURIComponent(accountId)}?${searchParams.toString()}`,
    {
      scope: "connect:accounts:read",
    }
  );
}

function parseWebhookSignature(signatureHeader: string) {
  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const versionPart = parts.find((part) => part.startsWith("v1="));

  if (!timestampPart || !versionPart) {
    throw new Error("Pipedream webhook signature header is malformed");
  }

  const timestamp = Number.parseInt(timestampPart.slice(2), 10);
  const signature = versionPart.slice(3);

  if (!Number.isFinite(timestamp) || !signature) {
    throw new Error("Pipedream webhook signature header is malformed");
  }

  return { timestamp, signature };
}

export function verifyPipedreamWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
) {
  if (!signatureHeader) {
    throw new Error("Missing Pipedream webhook signature");
  }

  const config = getPipedreamConfig();
  const { timestamp, signature } = parseWebhookSignature(signatureHeader);
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Pipedream webhook signature is too old");
  }

  const expected = createHmac("sha256", config.webhookSigningKey)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error("Invalid Pipedream webhook signature");
  }
}

export function parsePipedreamConnectionWebhookPayload(rawBody: string) {
  const payload = JSON.parse(
    rawBody
  ) as Partial<PipedreamConnectionWebhookPayload>;
  if (
    payload.event !== "CONNECTION_SUCCESS" &&
    payload.event !== "CONNECTION_ERROR"
  ) {
    throw new Error("Unsupported Pipedream connection webhook event");
  }

  return payload as PipedreamConnectionWebhookPayload;
}

export function isPipedreamManagedAuthCredentials(
  value: unknown
): value is PipedreamManagedAuthCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).kind === "pipedream_connect" &&
    (value as Record<string, unknown>).provider === "sentry" &&
    typeof (value as Record<string, unknown>).account_id === "string"
  );
}

export function parsePipedreamManagedAuthCredentials(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPipedreamManagedAuthCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function assertSentryPipedreamAccount(
  account: PipedreamAccount,
  options?: { requireCredentials?: boolean }
) {
  const expectedSlug = getPipedreamSentryAppSlug();
  if (account.app.name_slug !== expectedSlug) {
    throw new Error(
      `Pipedream account ${account.id} is for ${account.app.name_slug}, expected ${expectedSlug}`
    );
  }
  if (account.app.auth_type && account.app.auth_type !== "oauth") {
    throw new Error(
      `Sentry managed auth requires an OAuth-backed Pipedream account, got ${account.app.auth_type}`
    );
  }
  if (account.dead) {
    throw new Error("Sentry managed auth account is no longer active");
  }
  if (!account.healthy) {
    throw new Error(
      account.error ||
        "Sentry managed auth account is unhealthy — reconnect required"
    );
  }
  if (
    options?.requireCredentials &&
    typeof account.credentials?.oauth_access_token !== "string"
  ) {
    throw new Error(
      "Sentry managed auth account did not return an OAuth access token"
    );
  }
}

export function buildSentryManagedAuthCredentials(account: PipedreamAccount) {
  assertSentryPipedreamAccount(account);
  return JSON.stringify({
    kind: "pipedream_connect",
    provider: "sentry",
    account_id: account.id,
    app_slug: account.app.name_slug,
    account_name: account.name,
    external_user_id: account.external_id,
    authorized_scopes: account.authorized_scopes ?? null,
    connected_at: account.updated_at || account.created_at,
    expires_at: account.expires_at ?? null,
  } satisfies PipedreamManagedAuthCredentials);
}

export async function getSentryManagedAuthAccessToken(accountId: string) {
  const account = await retrievePipedreamAccount(accountId, {
    includeCredentials: true,
  });
  assertSentryPipedreamAccount(account, { requireCredentials: true });

  return {
    account,
    accessToken: account.credentials!.oauth_access_token!,
  };
}
