const ENV_VAR_KEYWORDS =
  /\b(?:env|environment|variable|key|secret|token|api_key|url)\b/i;
const ENV_VAR_MISSING =
  /\b(?:required|missing|not set|not found|not defined|not configured|undefined|invalid)\b/i;

const ENV_VAR_ERROR_PATTERNS: ReadonlyArray<{
  test: (s: string) => boolean;
  hint: string;
}> = [
  {
    // Next.js env validation (@t3-oss/env-nextjs, Zod-based) — emits
    // "Invalid environment variables:" followed by a field list.
    test: (s) => /invalid\s+environment\s+variables?/i.test(s),
    hint: "Environment variables failed validation",
  },
  {
    // Zod schema errors on env.mjs / env.ts. "ZodError" alone is too broad,
    // so require an env-adjacent keyword to avoid flagging unrelated Zod use.
    test: (s) => s.includes("ZodError") && ENV_VAR_KEYWORDS.test(s),
    hint: "Environment variables failed schema validation",
  },
  {
    test: (s) => /supabase/i.test(s) && /url|key|required/i.test(s),
    hint: "Missing Supabase environment variables (URL/Key)",
  },
  {
    // Prisma's own initialization error explicitly flags missing env
    // ("Environment variable not found: DATABASE_URL").
    test: (s) =>
      /PrismaClientInitializationError|environment\s+variable\s+not\s+found/i.test(
        s
      ),
    hint: "Missing Prisma datasource environment variable",
  },
  {
    test: (s) =>
      /database[_\s-]*url|prisma/i.test(s) &&
      /missing|required|not set|undefined|connect/i.test(s),
    hint: "Missing database connection environment variable",
  },
  {
    test: (s) => /clerk/i.test(s) && /key|publishable|secret/i.test(s),
    hint: "Missing Clerk environment variables",
  },
  {
    test: (s) =>
      /stripe/i.test(s) &&
      /key|secret/i.test(s) &&
      /missing|required|undefined/i.test(s),
    hint: "Missing Stripe environment variables",
  },
  {
    test: (s) =>
      /(openai|anthropic|gemini|groq|together)/i.test(s) &&
      /api[_\s-]?key|key.*required|missing/i.test(s),
    hint: "Missing AI provider API key environment variable",
  },
  {
    test: (s) =>
      /resend|sendgrid|postmark|mailgun/i.test(s) &&
      /api[_\s-]?key|token|required|missing/i.test(s),
    hint: "Missing email provider API key environment variable",
  },
  {
    test: (s) =>
      /nextauth|auth[_\s-]?secret|jwt[_\s-]?secret/i.test(s) &&
      /missing|required|undefined|not set/i.test(s),
    hint: "Missing auth secret environment variable",
  },
  {
    test: (s) => /process\.env\.[A-Z_]+/.test(s) && ENV_VAR_MISSING.test(s),
    hint: "Missing environment variables",
  },
  {
    test: (s) => ENV_VAR_MISSING.test(s) && ENV_VAR_KEYWORDS.test(s),
    hint: "Missing environment variables",
  },
  {
    test: (s) =>
      /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)[A-Z_]+\b/.test(s) &&
      /undefined|missing|required|not set/i.test(s),
    hint: "Missing environment variables",
  },
  {
    test: (s) =>
      /invariant|assert.*failed/i.test(s) &&
      /(env|config|url|key|token|secret)/i.test(s),
    hint: "Missing configuration (likely an environment variable)",
  },
];

/**
 * Scan arbitrary text (HTTP response body, boot log, process stderr) for
 * common environment-variable error patterns. Returns a short hint like
 * "Missing Supabase environment variables (URL/Key)" when a pattern matches,
 * or null otherwise.
 *
 * Pure / no runtime deps — safe to import from client components. Kept out
 * of health-status.ts to avoid pulling @vercel/sandbox into the browser
 * bundle via transitive imports.
 */
export function detectMissingEnvVarHint(
  text: string | null | undefined
): string | null {
  if (!text) return null;
  const snippet = text.slice(0, 8000);
  for (const { test, hint } of ENV_VAR_ERROR_PATTERNS) {
    if (test(snippet)) return hint;
  }
  return null;
}
