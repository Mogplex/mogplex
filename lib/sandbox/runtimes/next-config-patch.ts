/**
 * Patch helpers that inject `allowedDevOrigins` into a user's `next.config.*`
 * file so Next.js 16's cross-origin dev blocker does not reject HMR WebSocket
 * upgrades served through the Vercel Sandbox public domain.
 *
 * Why: Next.js 16's router-server applies `blockCrossSiteDEV` to every dev
 * resource request, including the `/_next/webpack-hmr` WebSocket upgrade.
 * The allow-list only contains localhost and the hosts declared in
 * `allowedDevOrigins`. The Vercel Sandbox domain (`sb-*.vercel.run`) is neither,
 * so HMR fails with 403 and the browser reports
 * `Firefox can't establish a connection to the server`.
 */

export const NEXT_CONFIG_CANDIDATES = [
  "next.config.mjs",
  "next.config.js",
  "next.config.ts",
  "next.config.cjs",
] as const;

export const MOGPLEX_SANDBOX_ORIGIN_PATTERN = "*.vercel.run";

const INJECTION_MARKER = "// mogplex: allowedDevOrigins";

/**
 * Patterns used to locate the opening brace of the exported config object.
 * Tried in priority order — the first match wins:
 *
 * 1. `export default {` — inline object literal export.
 * 2. `module.exports = {` — CJS inline object literal.
 * 3. Resolved identifier — if the file contains `export default <ident>`, we
 *    find the declaration of that identifier (`const/let/var <ident> = {`).
 * 4. Last generic variable — fallback: take the **last**
 *    `const/let/var <name> = {` in the file, which is typically the config.
 */
const INLINE_EXPORT_PATTERNS: readonly RegExp[] = [
  /export\s+default\s*\{/,
  /module\.exports\s*=\s*\{/,
];

const GENERIC_VAR_PATTERN = /(?:const|let|var)\s+\w+\s*(?::\s*\w+)?\s*=\s*\{/;

/**
 * Try to extract the identifier from `export default <ident>` (not an object
 * literal or function call). Returns `null` if no such export is found.
 */
function findExportedIdentifier(content: string): string | null {
  const m = content.match(/export\s+default\s+(\w+)\s*;/);
  return m ? m[1] : null;
}

function findConfigObjectOpening(
  content: string
): { index: number; length: number } | null {
  // 1 & 2: Try inline export patterns first.
  for (const pattern of INLINE_EXPORT_PATTERNS) {
    const match = content.match(pattern);
    if (match && typeof match.index === "number") {
      return { index: match.index, length: match[0].length };
    }
  }

  // 3: If the file has `export default <identifier>`, resolve that identifier's
  //    declaration so we inject into the right variable regardless of
  //    declaration order.
  const exportedIdent = findExportedIdentifier(content);
  if (exportedIdent) {
    const identPattern = new RegExp(
      `(?:const|let|var)\\s+${exportedIdent}\\s*(?::\\s*\\w+)?\\s*=\\s*\\{`
    );
    const match = content.match(identPattern);
    if (match && typeof match.index === "number") {
      return { index: match.index, length: match[0].length };
    }
  }

  // 4: Fallback — take the last generic variable-with-object-literal match.
  //    Next.js config files commonly define helper variables (plugins, etc.)
  //    before the actual config object, so the last match is the safest guess.
  const globalPattern = new RegExp(GENERIC_VAR_PATTERN.source, "g");
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = globalPattern.exec(content)) !== null) {
    lastMatch = m;
  }
  if (lastMatch && typeof lastMatch.index === "number") {
    return { index: lastMatch.index, length: lastMatch[0].length };
  }

  return null;
}

/**
 * Result of `patchNextConfigContent`.
 *
 * - `unchanged`: content already has `allowedDevOrigins` or could not be safely patched.
 * - `patched`: content was rewritten with the allowed origin injected.
 */
export type NextConfigPatchResult =
  | { kind: "unchanged"; reason: "already_configured" | "no_injection_point" }
  | { kind: "patched"; content: string };

export function buildStandaloneNextConfig(
  origin: string = MOGPLEX_SANDBOX_ORIGIN_PATTERN
): string {
  return [
    INJECTION_MARKER,
    "/** @type {import('next').NextConfig} */",
    "const nextConfig = {",
    `  allowedDevOrigins: [${JSON.stringify(origin)}],`,
    "};",
    "",
    "export default nextConfig;",
    "",
  ].join("\n");
}

/**
 * Inject `allowedDevOrigins` into existing next.config.* content.
 *
 * Idempotent: if `allowedDevOrigins` is already present anywhere in the file,
 * returns `unchanged/already_configured` so user-provided values are preserved.
 */
export function patchNextConfigContent(
  content: string,
  origin: string = MOGPLEX_SANDBOX_ORIGIN_PATTERN
): NextConfigPatchResult {
  if (/allowedDevOrigins\s*:/.test(content)) {
    return { kind: "unchanged", reason: "already_configured" };
  }

  const opening = findConfigObjectOpening(content);
  if (!opening) {
    return { kind: "unchanged", reason: "no_injection_point" };
  }

  const insertionPoint = opening.index + opening.length;
  const injection = `\n  allowedDevOrigins: [${JSON.stringify(origin)}], ${INJECTION_MARKER}`;

  return {
    kind: "patched",
    content:
      content.slice(0, insertionPoint) +
      injection +
      content.slice(insertionPoint),
  };
}
