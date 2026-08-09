import { withSentryConfig } from "@sentry/nextjs";

const __dirname = import.meta.dirname;

function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

const c15tBackendUrl = process.env.NEXT_PUBLIC_C15T_URL
  ? trimTrailingSlashes(process.env.NEXT_PUBLIC_C15T_URL)
  : undefined;

export function buildContentSecurityPolicy({ isDevelopment = false } = {}) {
  // Monaco Editor compiles language workers via `new Function()`, which
  // requires 'unsafe-eval'. Next.js also still injects inline bootstrap /
  // hydration scripts, so 'unsafe-inline' is required until we migrate to a
  // nonce-based CSP. `isDevelopment` is retained so we can layer additional
  // dev-only sources (e.g. HMR) without duplicating the allowlist.
  const scriptSrc = [
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://va.vercel-scripts.com",
  ];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    scriptSrc.join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: ws: wss:",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];

  // Local dev runs over plain HTTP; this directive upgrades same-origin
  // localhost fetches to HTTPS and masks the real route behavior.
  if (!isDevelopment) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

const contentSecurityPolicy = buildContentSecurityPolicy({
  isDevelopment: process.env.NODE_ENV === "development",
});

const allowedDevOrigins = process.env.MOGPLEX_ALLOWED_DEV_ORIGINS
  ? process.env.MOGPLEX_ALLOWED_DEV_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
  // Standalone output is only for the self-hosted Docker image (see
  // Dockerfile). Vercel builds must keep the default output mode, so this
  // is opt-in via env rather than set unconditionally.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["iconoir-react"],
  },
  turbopack: {
    root: __dirname,
    resolveAlias: {
      // pg reaches browser chunks through client-reachable modules that lazily
      // import lib/supabase/admin (→ the Neon PostgREST shim). Its node
      // builtins (dns, fs, net) don't resolve for the browser target, so the
      // browser condition swaps in a throwing stub; the server build is
      // untouched.
      pg: { browser: "./lib/db/pg-browser-stub.ts" },
    },
  },
  async redirects() {
    return [
      {
        source: "/favicon.png",
        destination: "/favicon.ico",
        permanent: true,
      },
      {
        source: "/apple-touch-icon.png",
        destination: "/apple-icon.png",
        permanent: true,
      },
      {
        source: "/apple-touch-icon-precomposed.png",
        destination: "/apple-icon.png",
        permanent: true,
      },
      {
        source: "/spaces",
        destination: "/projects/repositories",
        permanent: true,
      },
      {
        source: "/spaces/sandboxes",
        destination: "/projects/repositories/sandboxes",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    if (!c15tBackendUrl) {
      return [];
    }

    return [
      {
        source: "/api/c15t/:path*",
        destination: `${c15tBackendUrl}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

const shouldWrapWithSentry = Boolean(
  sentryOrg && sentryProject && sentryAuthToken
);

export default shouldWrapWithSentry
  ? withSentryConfig(nextConfig, {
      org: sentryOrg,
      project: sentryProject,
      authToken: sentryAuthToken,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      disableLogger: true,
      automaticVercelMonitors: false,
      ...(process.env.NODE_ENV === "development"
        ? {}
        : { tunnelRoute: "/monitoring" }),
    })
  : nextConfig;
