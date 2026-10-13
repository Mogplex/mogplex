import {
  configured,
  DOCS,
  type DoctorCheckResult,
  type DoctorEnv,
  isTruthyFlag,
  missing,
} from "./types";

const REQUIRED_SECRETS = [
  "CRON_SECRET",
  "INTERNAL_API_SECRET",
  "CONNECTIONS_ENCRYPTION_KEY",
  "EMAIL_UNSUBSCRIBE_SECRET",
] as const;

/** Same normalization lib/connections/encryption.ts applies before use. */
function normalizeHexKey(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = /^(["']).*\1$/.test(trimmed)
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.replace(/\\n/g, "").replace(/\s+/g, "");
}

export function checkAppConfig(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "app", docsUrl: DOCS.environmentVariables };
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    return {
      ...result,
      status: "fail",
      summary: "NEXT_PUBLIC_APP_URL is not set",
    };
  }
  if (!URL.canParse(appUrl)) {
    return {
      ...result,
      status: "fail",
      summary: "NEXT_PUBLIC_APP_URL is not a valid URL",
    };
  }
  const server = env.MOGPLEX_DATA_BACKEND?.trim() ?? "";
  const client = env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND?.trim() ?? "";
  if (server !== client) {
    return {
      ...result,
      status: "fail",
      summary:
        "MOGPLEX_DATA_BACKEND and NEXT_PUBLIC_MOGPLEX_DATA_BACKEND disagree",
    };
  }
  if (server !== "neon") {
    return {
      ...result,
      status: "warn",
      summary: "Data backend is not neon; self-hosting docs assume neon",
    };
  }
  return {
    ...result,
    status: "pass",
    summary: `App URL ${new URL(appUrl).origin}`,
  };
}

export function checkSecrets(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "secrets", docsUrl: DOCS.environmentVariables };
  const absent = missing(env, REQUIRED_SECRETS);
  if (absent.length > 0) {
    return {
      ...result,
      status: "fail",
      summary: `Missing ${absent.join(", ")}`,
    };
  }
  const key = normalizeHexKey(env.CONNECTIONS_ENCRYPTION_KEY ?? "");
  if (!/^[\dA-Fa-f]{64}$/.test(key)) {
    return {
      ...result,
      status: "fail",
      summary:
        "CONNECTIONS_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)",
    };
  }
  return { ...result, status: "pass", summary: "Required secrets are set" };
}

const SIGN_IN_PROVIDERS = [
  ["GitHub", "AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET"],
  ["Google", "AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"],
  ["Microsoft", "AUTH_MICROSOFT_CLIENT_ID", "AUTH_MICROSOFT_CLIENT_SECRET"],
] as const;

export function checkAuth(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "auth", docsUrl: DOCS.databaseAndAuth };
  if (!configured(env, "BETTER_AUTH_SECRET")) {
    return {
      ...result,
      status: "fail",
      summary: "BETTER_AUTH_SECRET is not set",
    };
  }
  const enabled: string[] = [];
  const halfConfigured: string[] = [];
  for (const [label, idName, secretName] of SIGN_IN_PROVIDERS) {
    const hasId = configured(env, idName);
    const hasSecret = configured(env, secretName);
    if (hasId && hasSecret) enabled.push(label);
    else if (hasId || hasSecret) halfConfigured.push(label);
  }
  if (configured(env, "RESEND_API_KEY")) enabled.push("email");
  if (enabled.length === 0) {
    return {
      ...result,
      status: "fail",
      summary:
        "No sign-in method: set an AUTH_*_CLIENT_ID/SECRET pair or RESEND_API_KEY",
    };
  }
  if (halfConfigured.length > 0) {
    return {
      ...result,
      status: "warn",
      summary: `Sign-in: ${enabled.join(", ")}; ${halfConfigured.join(", ")} has only one of its two values`,
    };
  }
  return {
    ...result,
    status: "pass",
    summary: `Sign-in: ${enabled.join(", ")}`,
  };
}

export function checkModels(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "models", docsUrl: DOCS.sandboxesAndModels };
  if (configured(env, "AI_GATEWAY_API_KEY")) {
    return {
      ...result,
      status: "pass",
      summary: "Platform AI Gateway key is set",
    };
  }
  return {
    ...result,
    status: "warn",
    summary: "No AI_GATEWAY_API_KEY: each user must add a provider key",
  };
}

export function checkAccess(env: DoctorEnv): DoctorCheckResult {
  const result = { id: "access", docsUrl: DOCS.giveUsersAccess };
  if (configured(env, "STRIPE_SECRET_KEY")) {
    return {
      ...result,
      status: "pass",
      summary: "Stripe billing grants access by balance",
    };
  }
  if (isTruthyFlag(env.MOGPLEX_SELF_HOSTED)) {
    return { ...result, status: "pass", summary: "MOGPLEX_SELF_HOSTED is set" };
  }
  const allowlists = [
    "PLATFORM_ACCESS_USER_IDS",
    "PLATFORM_ACCESS_EMAILS",
    "PLATFORM_ACCESS_EMAIL_DOMAINS",
  ].filter((name) => configured(env, name));
  if (allowlists.length > 0) {
    return {
      ...result,
      status: "pass",
      summary: `Access allowlist: ${allowlists.join(", ")}`,
    };
  }
  return {
    ...result,
    status: "warn",
    summary:
      "No billing and no PLATFORM_ACCESS_* allowlist: platform AI and sandboxes deny users without a profile grant",
  };
}
