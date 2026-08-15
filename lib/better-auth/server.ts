// Neon-backed Better Auth for browser sessions and hosted MCP OAuth.
//
// The handler is mounted at /api/auth/[...all]. Existing static /api/auth/*
// routes take precedence over the catch-all where legacy integrations still
// coexist during the remaining Supabase retirement work.
//
// Module load must stay side-effect-free: the pg Pool does not connect until
// first query, so importing this file without DATABASE_URL (CI builds) is safe.

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { mcp } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { dash } from "@better-auth/infra";
import { cliTokenTtl } from "@/lib/better-auth/cli-token-ttl";
import {
  hashAccountPassword,
  verifyAccountPassword,
} from "@/lib/better-auth/password";
import { Pool } from "pg";
import { createProfileForBetterAuthUser } from "@/lib/auth/better-auth-profile";
import { sendAuthActionEmail } from "@/lib/email/send-auth-action-email";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";
const mcpResource =
  process.env.MOGPLEX_MCP_RESOURCE_URL?.trim() ||
  new URL("/api/v1/mogplex/mcp", baseURL).toString();

const socialProviders: NonNullable<
  Parameters<typeof betterAuth>[0]["socialProviders"]
> = {};

function isLocalDevOrigin(origin: string) {
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.PLAYWRIGHT !== "1"
  ) {
    return false;
  }
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return true;
    }
    if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
      return true;
    }
    const match = /^172\.(\d+)\./.exec(hostname);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

function getTrustedOrigins(request?: Request) {
  const configured = [
    baseURL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BETTER_AUTH_URL,
  ].filter(Boolean);
  const origin = request?.headers.get("origin");
  if (origin && (configured.includes(origin) || isLocalDevOrigin(origin))) {
    configured.push(origin);
  }
  return [...new Set(configured)];
}

if (
  process.env.AUTH_GITHUB_CLIENT_ID &&
  process.env.AUTH_GITHUB_CLIENT_SECRET
) {
  socialProviders.github = {
    clientId: process.env.AUTH_GITHUB_CLIENT_ID,
    clientSecret: process.env.AUTH_GITHUB_CLIENT_SECRET,
  };
}

if (
  process.env.AUTH_GOOGLE_CLIENT_ID &&
  process.env.AUTH_GOOGLE_CLIENT_SECRET
) {
  socialProviders.google = {
    clientId: process.env.AUTH_GOOGLE_CLIENT_ID,
    clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET,
  };
}

if (
  process.env.AUTH_MICROSOFT_CLIENT_ID &&
  process.env.AUTH_MICROSOFT_CLIENT_SECRET
) {
  socialProviders.microsoft = {
    clientId: process.env.AUTH_MICROSOFT_CLIENT_ID,
    clientSecret: process.env.AUTH_MICROSOFT_CLIENT_SECRET,
    tenantId: process.env.AUTH_MICROSOFT_TENANT_ID || "common",
  };
}

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  // E2e-mode accommodations; PLAYWRIGHT is never set on real deployments.
  // - rateLimit: the auth specs fire several sign-in attempts back-to-back
  //   and CI retries reuse the same server, tripping the production-default
  //   limiter (429s).
  // trustedOrigins is resolved below for every runtime. Production trusts only
  // configured app/base URLs; local development and Playwright also allow
  // localhost and private-LAN origins so phone/Chrome testing can post to a
  // dev server bound on the local network.
  ...(process.env.PLAYWRIGHT === "1"
    ? {
        rateLimit: { enabled: false },
      }
    : {}),
  trustedOrigins: getTrustedOrigins,
  database: new Pool({
    // mogplex_DATABASE_URL is the Neon Vercel-integration var (managed,
    // auto-rotating); unprefixed DATABASE_URL covers local dev and CI.
    connectionString:
      process.env.DATABASE_URL || process.env.mogplex_DATABASE_URL,
    max: 5,
  }),
  advanced: {
    database: {
      // uuid ids so better-auth users can FK-map onto the existing
      // uuid-keyed profiles/auth.users shim at cutover.
      generateId: () => crypto.randomUUID(),
    },
  },
  session: {
    // Signed session snapshot in a cookie so the proxy can authenticate
    // requests without a database round-trip; the API layer still validates
    // the real session. Revocation propagates within maxAge.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Only provision profiles when profiles live in the same database
          // better-auth writes to — i.e. after the Neon data cutover. Before
          // that, Supabase's OAuth callback owns profile creation.
          if (process.env.MOGPLEX_DATA_BACKEND !== "neon") return;
          await createProfileForBetterAuthUser(user);
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    password: {
      hash: hashAccountPassword,
      verify: verifyAccountPassword,
    },
    sendResetPassword: async ({ user, url }) => {
      const result = await sendAuthActionEmail({
        kind: "reset-password",
        email: user.email,
        actionUrl: url,
      });
      if (!result.ok) {
        // Fail closed: better-auth surfaces the error instead of telling the
        // user a reset email is on the way when delivery is broken.
        throw new Error(`auth email delivery failed: ${result.reason}`);
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const result = await sendAuthActionEmail({
        kind: "verify-email",
        email: user.email,
        actionUrl: url,
      });
      if (!result.ok) {
        throw new Error(`auth email delivery failed: ${result.reason}`);
      }
    },
  },
  socialProviders,
  plugins: [
    mcp({
      loginPage: "/login",
      resource: mcpResource,
      oidcConfig: {
        loginPage: "/login",
        defaultScope: "read write",
        scopes: ["read", "write"],
        requirePKCE: true,
        // Hosted MCP clients must never be forced to re-authenticate:
        // refresh tokens rotate on use, and ~100 years is "never" without
        // overflowing a JS Date. The mogplex CLI is the exception — the
        // cliTokenTtl hook below clamps its refresh tokens to 30 days.
        refreshTokenExpiresIn: 100 * 365 * 24 * 60 * 60,
      },
    }),
    cliTokenTtl(),
    sso(),
    // Better Auth cloud dashboard (ownership verification + remote admin).
    // Every dash endpoint requires a signed payload matched against
    // BETTER_AUTH_API_KEY; with the key unset they reject, so mounting
    // unconditionally is safe.
    dash(),
    // nextCookies must stay last: it rewrites Set-Cookie handling for
    // Next.js server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
