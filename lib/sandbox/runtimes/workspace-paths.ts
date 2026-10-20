import { posix } from "node:path";
import picomatch from "picomatch";
import { parse as parseJSON5 } from "json5";
import { parse } from "yaml";
import type { RepositoryFiles } from "../repository-files";

const GENERATED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "venv",
  "__pycache__",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function readConfig(files: RepositoryFiles, path: string) {
  // Access failures must reach the caller; malformed optional metadata can
  // fall back to discovery of actual app directories.
  const text = await files.readText(path);
  try {
    return record(
      text ? (path.endsWith(".yaml") ? parse(text) : parseJSON5(text)) : null
    );
  } catch {
    return {};
  }
}

function normalizePattern(value: string): string | null {
  const normalized = posix.normalize(value.trim().replaceAll("\\", "/"));
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized)
  )
    return null;
  return normalized.replace(/\/$/, "");
}

export function isDiscoveryDirectory(name: string) {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith(".") &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !GENERATED_DIRECTORIES.has(name)
  );
}

export async function readWorkspacePatterns(files: RepositoryFiles) {
  const [pnpm, pkg, lerna, nx, rush] = await Promise.all([
    readConfig(files, "pnpm-workspace.yaml"),
    readConfig(files, "package.json"),
    readConfig(files, "lerna.json"),
    readConfig(files, "nx.json"),
    readConfig(files, "rush.json"),
  ]);
  let patterns = strings(pnpm.packages);
  if (patterns.length === 0) patterns = strings(pkg.workspaces);
  if (patterns.length === 0)
    patterns = strings(record(pkg.workspaces).packages);
  if (patterns.length === 0) patterns = strings(lerna.packages);
  const appsDir = record(nx.workspaceLayout).appsDir;
  if (typeof appsDir === "string") patterns.push(`${appsDir}/*`);
  if (Array.isArray(rush.projects)) {
    patterns.push(
      ...rush.projects.flatMap((project: unknown) => {
        const folder = record(project).projectFolder;
        return typeof folder === "string" ? [folder] : [];
      })
    );
  }
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const value of patterns) {
    const pattern = value.trim();
    const negative = pattern.startsWith("!") && !pattern.startsWith("!(");
    const normalized = normalizePattern(negative ? pattern.slice(1) : pattern);
    if (normalized) (negative ? excludes : includes).push(normalized);
  }
  return { includes, excludes };
}

export function workspacePathFilter(excludes: string[]) {
  const excluded =
    excludes.length > 0 ? picomatch(excludes, { dot: true }) : () => false;
  return (path: string) =>
    !excluded(path) && path.split("/").every(isDiscoveryDirectory);
}

/** Expand configured paths only. Globstars recurse through source directories;
 * ordinary patterns stop at their declared depth. No repository code runs. */
export async function discoverWorkspacePaths(
  files: RepositoryFiles,
  patterns: Awaited<ReturnType<typeof readWorkspacePatterns>>
) {
  const allowed = workspacePathFilter(patterns.excludes);
  const listings = new Map<string, Promise<string[]>>();
  const list = (path: string) => {
    let pending = listings.get(path);
    if (!pending) {
      pending = files
        .listDirectories(path)
        .then((names) => names.filter(isDiscoveryDirectory).sort());
      listings.set(path, pending);
    }
    return pending;
  };
  const groups = await Promise.all(
    patterns.includes.map(async (pattern) => {
      const scan = picomatch.scan(pattern);
      if (!scan.isGlob) return allowed(pattern) ? [pattern] : [];
      const matches = picomatch(pattern);
      const paths: string[] = [];
      const maxDepth = pattern.includes("**")
        ? Infinity
        : pattern.split("/").length;
      const visit = async (path: string): Promise<void> => {
        if (path && !allowed(path)) return;
        if (path && matches(path)) paths.push(path);
        if (path && path.split("/").length >= maxDepth) return;
        await Promise.all(
          (await list(path)).map((name) =>
            visit(path ? `${path}/${name}` : name)
          )
        );
      };
      if (!scan.base || allowed(scan.base)) await visit(scan.base);
      return paths;
    })
  );
  return { paths: [...new Set(groups.flat())].sort(), allowed };
}
