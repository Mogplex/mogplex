import { resolveSandboxPath } from "@/lib/repo-settings";
import {
  discoverWorkspacePaths,
  isDiscoveryDirectory,
  readWorkspacePatterns,
  workspacePathFilter,
} from "./workspace-paths";
import type { Sandbox } from "@vercel/sandbox";
import {
  sandboxRepositoryFiles,
  type RepositoryFiles,
} from "../repository-files";

async function readTextFile(sandbox: RepositoryFiles, path: string) {
  return (await sandbox.readText(path)) ?? "";
}

/** Common directory names where a web app lives inside a monorepo.
 * Probed in order when auto-selecting a preview target. */
const COMMON_WEB_WORKSPACE_PATHS = [
  "web",
  "app",
  "apps/web",
  "apps/app",
  "apps/next",
  "apps/frontend",
  "apps/website",
  "apps/docs",
  "packages/web",
  "packages/app",
  "packages/next",
  "packages/frontend",
  "frontend",
  "client",
  "site",
  "website",
  "docs",
] as const;

/** Subdirectories scanned when common paths miss. */
const MONOREPO_SCAN_DIRS = ["apps", "packages", "services"] as const;

/** Dev-script substring -> framework label. Used when deps don't name it. */
const DEV_SCRIPT_FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/\bnext\b/, "next"],
  [/\bvite\b/, "vite"],
  [/\bnuxt\b/, "nuxt"],
  [/\bastro\b/, "astro"],
  [/\bremix\b/, "remix"],
  [/\bsveltekit\b/, "sveltekit"],
  [/\bgatsby\b/, "gatsby"],
  [/\bng\s+serve\b/, "angular"],
  [/\bangular\b/, "angular"],
  [/\bdocusaurus\b/, "docusaurus"],
  [/\bsolid-start\b/, "solid"],
];

/** Framework preference when multiple web workspaces match. Lower = better. */
const FRAMEWORK_PRIORITY: Record<string, number> = {
  next: 0,
  nuxt: 1,
  sveltekit: 2,
  astro: 3,
  remix: 4,
  vite: 5,
  react: 6,
  vue: 7,
  angular: 8,
  solid: 9,
  gatsby: 10,
  docusaurus: 11,
};

type WebPackageInfo = {
  name: string | null;
  devScript: string | null;
  framework: string | null;
};

async function readPackageJsonInfo(
  sandbox: RepositoryFiles,
  rootDir?: string | null
): Promise<WebPackageInfo | null> {
  const pkgPath = resolveSandboxPath(rootDir, "package.json");
  const raw = await readTextFile(sandbox, pkgPath);
  try {
    if (!raw) return null;
    const pkg = JSON.parse(raw) as {
      name?: unknown;
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const devScript =
      typeof pkg.scripts?.dev === "string"
        ? pkg.scripts.dev.trim() || null
        : null;
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    let framework: string | null = null;
    if (deps.next) framework = "next";
    else if (deps.nuxt) framework = "nuxt";
    else if (deps["@sveltejs/kit"]) framework = "sveltekit";
    else if (deps.astro) framework = "astro";
    else if (deps["@remix-run/react"] || deps.remix) framework = "remix";
    else if (deps.vite) framework = "vite";
    else if (deps["@angular/core"]) framework = "angular";
    else if (deps["solid-start"] || deps["@solidjs/start"]) framework = "solid";
    else if (deps.gatsby) framework = "gatsby";
    else if (deps["@docusaurus/core"]) framework = "docusaurus";
    else if (deps.react) framework = "react";
    else if (deps.vue) framework = "vue";
    else if (devScript) {
      for (const [pattern, label] of DEV_SCRIPT_FRAMEWORK_PATTERNS) {
        if (pattern.test(devScript)) {
          framework = label;
          break;
        }
      }
    }
    return {
      name: typeof pkg.name === "string" ? pkg.name : null,
      devScript,
      framework,
    };
  } catch {
    return null;
  }
}

/** True when the package declares a recognised web framework or its dev
 * script invokes one (covers cases where devDeps live at workspace root). */
function isWebPackage(info: WebPackageInfo | null): boolean {
  if (!info) return false;
  if (info.framework) return true;
  if (
    info.devScript &&
    DEV_SCRIPT_FRAMEWORK_PATTERNS.some(([p]) => p.test(info.devScript!))
  ) {
    return true;
  }
  return false;
}

/** True when the package is a web app AND has a dev script so the sandbox
 * can actually launch a preview. Prevents auto-selecting library packages
 * that happen to depend on a web framework but have no runnable dev server. */
function isViablePreviewTarget(info: WebPackageInfo | null): boolean {
  if (!info) return false;
  if (!info.devScript) return false;
  return isWebPackage(info);
}

export function resolveMonorepoWebTarget(sandbox: Sandbox) {
  return resolveMonorepoWebTargetFromFiles(sandboxRepositoryFiles(sandbox));
}

/**
 * Select a runnable nested web app without requiring workspace metadata.
 * Explicit launch roots bypass this function. A runnable root app wins;
 * otherwise common app paths, configured workspaces, then source directories
 * are considered. Framework priority and path order make fallback deterministic.
 */
export async function resolveMonorepoWebTargetFromFiles(
  sandbox: RepositoryFiles
): Promise<{ path: string; framework: string | null } | null> {
  const rootInfo = await readPackageJsonInfo(sandbox, null);
  if (isViablePreviewTarget(rootInfo)) return null;

  const patterns = await readWorkspacePatterns(sandbox);
  // Apply exclusions to common paths too; an excluded legacy web/ must never
  // shadow the app declared in workspace configuration.
  const allowed = workspacePathFilter(patterns.excludes);
  const commonResults = await Promise.all(
    COMMON_WEB_WORKSPACE_PATHS.filter(allowed).map(async (path) => ({
      path,
      info: await readPackageJsonInfo(sandbox, path),
    }))
  );
  for (const { path, info } of commonResults) {
    if (isViablePreviewTarget(info))
      return { path, framework: info!.framework };
  }

  const configured = await discoverWorkspacePaths(sandbox, patterns);
  const choose = async (candidates: string[]) => {
    const results = await Promise.all(
      [...new Set(candidates)].filter(allowed).map(async (path) => ({
        path,
        info: await readPackageJsonInfo(sandbox, path),
      }))
    );
    const viable = results.filter(({ info }) => isViablePreviewTarget(info));
    viable.sort(
      (a, b) =>
        (FRAMEWORK_PRIORITY[a.info!.framework!] ?? 100) -
          (FRAMEWORK_PRIORITY[b.info!.framework!] ?? 100) ||
        a.path.localeCompare(b.path, "en")
    );
    return viable[0]
      ? { path: viable[0].path, framework: viable[0].info!.framework }
      : null;
  };
  const selected = await choose(configured.paths);
  if (selected) return selected;

  const rootDirs = (await sandbox.listDirectories("")).filter(
    isDiscoveryDirectory
  );
  const nested = await Promise.all(
    MONOREPO_SCAN_DIRS.map(async (directory) =>
      (await sandbox.listDirectories(directory))
        .filter(isDiscoveryDirectory)
        .map((name) => `${directory}/${name}`)
    )
  );
  return choose([...rootDirs, ...nested.flat()]);
}
