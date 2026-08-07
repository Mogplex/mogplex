import { tool } from "ai";
import type { Tool } from "ai";

export type RepoToolDefaults = {
  owner?: string;
  repo?: string;
  branch?: string;
  baseBranch?: string;
  rootDirectory?: string | null;
};

/**
 * Base URL for self-directed API calls. Tools run server-side, so they need an
 * absolute origin: the explicit app URL when configured, the Vercel deployment
 * URL on preview/production, and localhost in development.
 */
export function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

export const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as unknown as Tool);

export function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\da-z]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function encodeGitHubPath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function resolveRepoTarget(
  input: { owner?: string; repo?: string; branch?: string },
  defaults?: RepoToolDefaults
) {
  const owner = input.owner || defaults?.owner;
  const repo = input.repo || defaults?.repo;
  const branch = input.branch || defaults?.branch || "main";

  if (!owner || !repo) {
    return {
      error:
        "Missing repository context. Re-run the request from an active workspace or specify owner and repo.",
    };
  }

  return { owner, repo, branch };
}
