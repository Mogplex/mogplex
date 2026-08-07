/**
 * Internal utilities for PR fixer tools.
 * @module
 */

import { normalizeRootDirectory } from "@/lib/repo-settings";
import type { Sandbox } from "@vercel/sandbox";

export type SandboxFileAccess = Pick<
  Sandbox,
  "readFileToBuffer" | "runCommand" | "writeFiles"
>;

export function encodePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function normalizeRepoPath(path: string) {
  const normalized = path
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Path must be a relative repository path");
  }
  return normalized;
}

/**
 * Agents are prompted with repo-root-relative paths, but sandbox commands run
 * inside rootDirectory when one is configured. Accept both repo-root inputs
 * like "app/src/file.ts" and root-relative inputs like "src/file.ts"; listFiles
 * preserves the stripped target convention while read/update return the user's
 * normalized input path.
 */
export function stripSandboxRootDirectory(
  path: string,
  rootDirectory?: string | null
) {
  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  if (!normalizedRoot) return path;
  if (path === normalizedRoot) return ".";
  return path.startsWith(`${normalizedRoot}/`)
    ? path.slice(normalizedRoot.length + 1)
    : path;
}

export async function readCommandOutput(
  result: Awaited<ReturnType<SandboxFileAccess["runCommand"]>>,
  stream: "stdout" | "stderr"
) {
  const reader = result[stream];
  return typeof reader === "function" ? await reader.call(result) : "";
}

export function parentDirectory(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

export function buildCommitUrl(repoFullName: string, sha: string | null) {
  return sha ? `https://github.com/${repoFullName}/commit/${sha}` : null;
}

export function extractCommitSha(output: string) {
  return (
    output
      .split(/\s+/)
      .reverse()
      .find((part) => /^[0-9a-f]{40}$/i.test(part)) ?? null
  );
}

export function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}
