// better-auth foundation (Supabase-auth replacement, Neon-backed).
//
// This instance is NOT wired into the UI yet — Supabase auth remains the live
// sign-in path until the Neon cutover. The handler is mounted at
// /api/auth/[...all]; existing static /api/auth/* routes (login, logout,
// waitlist, …) take precedence over the catch-all, so both stacks coexist.
//
// Module load must stay side-effect-free: the pg Pool does not connect until
// first query, so importing this file without DATABASE_URL (CI builds) is safe.

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { sso } from "@better-auth/sso";
import { dash } from "@better-auth/infra";
import { Pool } from "pg";
import { sendAuthActionEmail } from "@/lib/email/send-auth-action-email";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

const socialProviders: NonNullable<
  Parameters<typeof betterAuth>[0]["socialProviders"]
> = {};

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
  // - trustedOrigins: the specs hit localhost:<port> while baseURL points at
  //   the public origin, so cookie-authenticated POSTs would fail the CSRF
  //   origin check; trust the request's own origin instead.
  ...(process.env.PLAYWRIGHT === "1"
    ? {
        rateLimit: { enabled: false },
        trustedOrigins: (request?: Request) => {
          const origin = request?.headers.get("origin");
          return origin ? [origin] : [];
        },
      }
    : {}),
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
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
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
