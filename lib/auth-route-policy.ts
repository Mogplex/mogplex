type RoutePolicyEntry =
  | { path: string; match: "exact" }
  | { path: string; match: "subtree" }
  | { path: string; match: "prefix" };

const PUBLIC_ROUTE_PATHS: readonly RoutePolicyEntry[] = [
  { path: "/", match: "exact" },
  { path: "/login", match: "subtree" },
  { path: "/request-access", match: "subtree" },
  { path: "/api/auth/", match: "prefix" },
  { path: "/auth/callback", match: "subtree" },
  { path: "/auth/error", match: "subtree" },
  { path: "/oauth/consent", match: "subtree" },
  { path: "/api/oauth/decision", match: "exact" },
  { path: "/.well-known/oauth-protected-resource", match: "subtree" },
  // The MCP route owns its bearer validation and must be able to return the
  // RFC 9728 WWW-Authenticate challenge before a client has a token.
  { path: "/api/v1/mogplex/mcp", match: "exact" },
  { path: "/api/webhooks/", match: "prefix" },
  { path: "/workflows", match: "subtree" },
  { path: "/how-it-works", match: "subtree" },
  { path: "/faq", match: "subtree" },
  { path: "/privacy", match: "subtree" },
  { path: "/slack/link", match: "exact" },
  { path: "/terms", match: "subtree" },
  { path: "/conduct", match: "subtree" },
  { path: "/install.sh", match: "subtree" },
  { path: "/install.ps1", match: "subtree" },
  { path: "/robots.txt", match: "exact" },
  { path: "/sitemap.xml", match: "exact" },
  { path: "/llms.txt", match: "exact" },
  { path: "/api/cli/latest", match: "subtree" },
  // Invite accept page must work for logged-out recipients so we can show the
  // team name + "Continue with GitHub" CTA before auth. The page server-fetches
  // the invite (no token-derived data on the URL beyond the bearer token), and
  // the POST accept endpoint still requires session auth.
  { path: "/invite/", match: "prefix" },
] as const;

const DELEGATED_INTERNAL_API_PATHS: readonly RoutePolicyEntry[] = [
  { path: "/api/sandbox", match: "subtree" },
] as const;

const MACHINE_AUTH_PATHS: readonly RoutePolicyEntry[] = [
  { path: "/api/cron/", match: "prefix" },
  { path: "/api/agent/review", match: "exact" },
  { path: "/api/jobs/process", match: "exact" },
] as const;

const CLI_PAT_API_PATHS: readonly RoutePolicyEntry[] = [
  { path: "/api/v1/mogplex", match: "subtree" },
  { path: "/api/settings", match: "exact" },
  { path: "/api/models", match: "exact" },
  { path: "/api/mcp-servers", match: "exact" },
  { path: "/api/sandbox", match: "subtree" },
  { path: "/api/cli/inference/chat/completions", match: "exact" },
  { path: "/api/cli/openai/chat/completions", match: "exact" },
] as const;

function matchesDeclaredPath(pathname: string, entry: RoutePolicyEntry) {
  switch (entry.match) {
    case "exact":
      return pathname === entry.path;
    case "prefix":
      return pathname.startsWith(entry.path);
    case "subtree":
      // "subtree" preserves the proxy's legacy bare-entry semantics: the
      // declared path itself plus child paths under `path/`, but never sibling
      // prefixes like `/install.shXXX`.
      return pathname === entry.path || pathname.startsWith(`${entry.path}/`);
  }
}

function matchesDeclaredPaths(
  pathname: string,
  entries: readonly RoutePolicyEntry[]
) {
  return entries.some((entry) => matchesDeclaredPath(pathname, entry));
}

export function isPublicRoutePath(pathname: string) {
  return matchesDeclaredPaths(pathname, PUBLIC_ROUTE_PATHS);
}

export function allowsDelegatedInternalApiPath(pathname: string) {
  return matchesDeclaredPaths(pathname, DELEGATED_INTERNAL_API_PATHS);
}

export function allowsMachineApiPath(pathname: string) {
  return matchesDeclaredPaths(pathname, MACHINE_AUTH_PATHS);
}

export function allowsCliPatApiPath(pathname: string) {
  return matchesDeclaredPaths(pathname, CLI_PAT_API_PATHS);
}
