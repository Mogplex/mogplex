import { resolveSandboxPath } from "@/lib/repo-settings";
import { parsePnpmWorkspaceGlobs } from "@/lib/monorepo-detection";
import type { Sandbox } from "@vercel/sandbox";

async function readTextFile(sandbox: Sandbox, path: string) {
  const buffer = await sandbox.readFileToBuffer({ path });
  return buffer ? buffer.toString("utf-8") : "";
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
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<WebPackageInfo | null> {
  const pkgPath = resolveSandboxPath(rootDir, "package.json");
  try {
    const raw = await readTextFile(sandbox, pkgPath);
    if (!raw) return null;
    const pkg = JSON.parse(raw) as {
      name?: unknown;
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const devScript =
      typeof pkg.scripts?.dev === "string" ? pkg.scripts.dev : null;
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

/**
 * Parse the monorepo workspace config (pnpm-workspace.yaml, package.json
 * workspaces, or lerna.json) and return categorised paths:
 * - directPaths: specific workspace paths to probe (e.g. "web", "dashboard")
 * - scanDirs: directories whose subdirectories should be listed (e.g. "packages")
 */
async function resolveWorkspaceScanTargets(
  sandbox: Sandbox
): Promise<{ directPaths: string[]; scanDirs: string[] }> {
  const directPaths: string[] = [];
  const scanDirs: string[] = [];
  const seen = new Set<string>();

  let globs: string[] = [];

  // Try pnpm-workspace.yaml first (most explicit config).
  try {
    const pnpmWsText = await readTextFile(sandbox, "pnpm-workspace.yaml");
    if (pnpmWsText) {
      globs = parsePnpmWorkspaceGlobs(pnpmWsText);
    }
  } catch {
    /* ignore */
  }

  // Fall back to package.json workspaces field.
  if (globs.length === 0) {
    try {
      const rootPkgText = await readTextFile(sandbox, "package.json");
      if (rootPkgText) {
        const parsed = JSON.parse(rootPkgText) as {
          workspaces?: string[] | { packages?: string[] };
        };
        if (Array.isArray(parsed.workspaces)) {
          globs = parsed.workspaces;
        } else if (Array.isArray(parsed.workspaces?.packages)) {
          globs = parsed.workspaces.packages;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Fall back to lerna.json packages field.
  if (globs.length === 0) {
    try {
      const lernaText = await readTextFile(sandbox, "lerna.json");
      if (lernaText) {
        const parsed = JSON.parse(lernaText) as { packages?: string[] };
        if (Array.isArray(parsed.packages)) {
          globs = parsed.packages;
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const glob of globs) {
    const normalized = glob
      .trim()
      .replace(/^\.\/+/, "")
      .replace(/\/+$/, "");
    if (!normalized || normalized === ".") continue;

    if (normalized.includes("*")) {
      // Glob pattern -> extract the parent directory to scan.
      const dir = normalized.replace(/\/\*\*?$/, "").replace(/\/+$/, "");
      if (dir && !seen.has(dir)) {
        scanDirs.push(dir);
        seen.add(dir);
      }
    } else if (!seen.has(normalized)) {
      directPaths.push(normalized);
      seen.add(normalized);
    }
  }

  return { directPaths, scanDirs };
}

/** Checks whether the repo root is the top of a monorepo (so we should
 * consider redirecting to a workspace member). */
async function isMonorepoRoot(sandbox: Sandbox): Promise<boolean> {
  const [pnpmWs, turboJson, lernaJson, nxJson, rushJson] = await Promise.all([
    sandbox.readFile({ path: "pnpm-workspace.yaml" }),
    sandbox.readFile({ path: "turbo.json" }),
    sandbox.readFile({ path: "lerna.json" }),
    sandbox.readFile({ path: "nx.json" }),
    sandbox.readFile({ path: "rush.json" }),
  ]);
  if (pnpmWs || turboJson || lernaJson || nxJson || rushJson) return true;
  try {
    const raw = await readTextFile(sandbox, "package.json");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { workspaces?: unknown };
    return Boolean(parsed.workspaces);
  } catch {
    return false;
  }
}

/** Escape a path for use inside a single-quoted shell literal. */
function escapeSingleQuoted(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

/** List immediate subdirectories via `find` (shell-safe, no glob expansion). */
async function listSandboxSubdirs(
  sandbox: Sandbox,
  dir: string
): Promise<string[]> {
  try {
    const cmd = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-lc",
        `find '${escapeSingleQuoted(dir)}' -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -50 || true`,
      ],
    });
    const stdout = await cmd.stdout();
    return stdout
      .split("\n")
      .map((l) => l.trim().replace(/^\.\//, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Auto-select a web-app workspace inside a monorepo when the caller didn't
 * pin a rootDirectory. Returns null if the root itself is a web app, no
 * monorepo markers exist, or no candidate workspace looks like a web app.
 *
 * Preference order when multiple candidates match:
 *   1. Common paths (web, apps/web, packages/web, ...) - first match wins
 *   2. Direct workspace paths from config (pnpm-workspace.yaml, package.json
 *      workspaces, lerna.json) - sorted by framework priority
 *   3. Scanned subdirectories of workspace dirs (from config, falling back to
 *      apps/, packages/, services/) - sorted by framework priority
 *      (Next > Nuxt > SvelteKit > Astro > Remix > Vite > React/Vue > ...)
 *
 * Only workspaces with a recognised framework AND a `dev` script are eligible
 * so the sandbox can actually launch a preview server.
 */
export async function resolveMonorepoWebTarget(
  sandbox: Sandbox
): Promise<{ path: string; framework: string | null } | null> {
  // Only activates for monorepos.
  if (!(await isMonorepoRoot(sandbox))) return null;

  // If the repo root itself is a web app, don't redirect - the user's dev
  // server already lives at the root.
  const rootInfo = await readPackageJsonInfo(sandbox, null);
  if (isWebPackage(rootInfo)) return null;

  // Phase 1: Probe well-known paths in parallel (fast path, deterministic order).
  const commonResults = await Promise.all(
    COMMON_WEB_WORKSPACE_PATHS.map(async (candidate) => ({
      path: candidate,
      info: await readPackageJsonInfo(sandbox, candidate),
    }))
  );
  for (const { path, info } of commonResults) {
    if (isViablePreviewTarget(info)) {
      return { path, framework: info!.framework };
    }
  }

  // Phase 2: Parse workspace config for paths beyond the common set.
  const commonSet = new Set<string>(
    COMMON_WEB_WORKSPACE_PATHS as readonly string[]
  );
  const { directPaths, scanDirs } = await resolveWorkspaceScanTargets(sandbox);

  // Probe direct workspace paths not already covered by common paths.
  const extraDirect = directPaths.filter((p) => !commonSet.has(p));
  if (extraDirect.length > 0) {
    const directResults = await Promise.all(
      extraDirect.map(async (path) => ({
        path,
        info: await readPackageJsonInfo(sandbox, path),
      }))
    );
    const viable = directResults
      .filter(({ info }) => isViablePreviewTarget(info))
      .map(({ path, info }) => ({
        path,
        framework: info!.framework!,
        priority:
          FRAMEWORK_PRIORITY[info!.framework!] ??
          Object.keys(FRAMEWORK_PRIORITY).length,
      }));
    if (viable.length > 0) {
      viable.sort((a, b) => a.priority - b.priority);
      return { path: viable[0].path, framework: viable[0].framework };
    }
  }

  // Phase 3: Scan workspace directories for web-app subdirectories.
  // Merge config-discovered dirs with defaults, deduplicated.
  const allScanDirs = new Set([
    ...scanDirs,
    ...(MONOREPO_SCAN_DIRS as readonly string[]),
  ]);
  const candidates: Array<{
    path: string;
    framework: string;
    priority: number;
  }> = [];

  for (const scanDir of allScanDirs) {
    const subdirs = await listSandboxSubdirs(sandbox, scanDir);
    const subdirResults = await Promise.all(
      subdirs.map(async (subdir) => ({
        subdir,
        info: await readPackageJsonInfo(sandbox, subdir),
      }))
    );
    for (const { subdir, info } of subdirResults) {
      if (isViablePreviewTarget(info) && info!.framework) {
        candidates.push({
          path: subdir,
          framework: info!.framework,
          priority:
            FRAMEWORK_PRIORITY[info!.framework] ??
            Object.keys(FRAMEWORK_PRIORITY).length,
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priority - b.priority);
  return { path: candidates[0].path, framework: candidates[0].framework };
}
