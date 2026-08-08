import {
  resolveSandboxPath,
  normalizeRootDirectory,
} from "@/lib/repo-settings";
import {
  buildStandaloneNextConfig,
  NEXT_CONFIG_CANDIDATES,
  patchNextConfigContent,
} from "./next-config-patch";
import type { Sandbox } from "@vercel/sandbox";
import type { RuntimeStrategy } from "./types";

// Re-export from sibling module to preserve public API
export { resolveMonorepoWebTarget } from "./node-monorepo";

function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

function buildShellCommand(command: string, rootDirectory?: string | null) {
  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  if (!normalizedRoot) return command;
  return `cd '${escapeShell(normalizedRoot)}' && ${command}`;
}

async function readTextFile(sandbox: Sandbox, path: string) {
  const buffer = await sandbox.readFileToBuffer({ path });
  return buffer ? buffer.toString("utf-8") : "";
}

/**
 * Build the command that compiles workspace dependencies (e.g. `workspace:*`
 * deps with a TypeScript build step) before the dev server starts.
 *
 * Without this, fresh sandboxes crash on dev when a workspace package points
 * at `dist/index.js` via its package.json `main`/`exports` - the compiled
 * output doesn't exist until the dep is built.
 *
 * Only pnpm and yarn (v2+) are supported; npm and bun lack a reliable way to
 * filter "dependencies of package X" in a single command.
 */
export function buildWorkspaceDepsBuildCommand(
  pm: string,
  packageName: string
): string | null {
  if (!packageName) return null;
  const escapedName = escapeShell(packageName);
  if (pm === "pnpm") {
    // `<pkg>^...` selects the transitive dependencies of <pkg>, excluding
    // <pkg> itself. `--if-present` must come BEFORE the script name - when
    // placed after `build`, pnpm forwards it as a script argument (so a
    // workspace with `"build": "tsc"` ends up running `tsc --if-present`,
    // which fails with `error TS5023: Unknown compiler option`).
    return `pnpm --filter '${escapedName}^...' run --if-present build`;
  }
  if (pm === "yarn") {
    // yarn v2+ workspaces foreach traverses by package graph.
    // `-R` = recursive (transitive deps), `--topological` preserves dep order.
    // `|| true` tolerates yarn-classic (v1) environments where this command
    // doesn't exist - we fall through to the normal dev phase instead.
    return `yarn workspaces foreach --from '${escapedName}' --topological -R run build || true`;
  }
  return null;
}

export const nodeStrategy: RuntimeStrategy = {
  id: "node22",
  name: "Node.js",
  defaultPort: 3000,
  // Expose the Next.js fallback range (3000 -> 3001 -> ... when another
  // workspace already binds 3000 in a turbo/nx monorepo) plus Vite's
  // default. System ports like 8080/8000 are reserved by the Vercel
  // sandbox runtime and rejected at creation time, so keep the list
  // tight. If a project needs a custom port, it's picked up via the
  // package.json dev script hint (e.g. "next dev -p 4200") and gets
  // merged into the exposed ports via Set dedup in createSandboxForRepo.
  defaultPorts: [3000, 3001, 3002, 3003, 3004, 3005, 5173],
  rebuildTargets: ["esbuild", "sharp", "next", "turbo", "@swc/core"],
  buildWorkspaceDepsBuildCommand,

  async detect(sandbox, rootDir) {
    const pkgPath = resolveSandboxPath(rootDir, "package.json");
    const pkgFile = await sandbox.readFile({ path: pkgPath });
    if (!pkgFile) return null;

    const { pm, installFromRoot } = await detectNodePackageManager(
      sandbox,
      rootDir
    );
    const framework = await detectNodeFramework(sandbox, rootDir);

    return {
      runtime: "node22",
      packageManager: pm,
      framework,
      installFromRoot,
    };
  },

  buildInstallCommand(pm) {
    return `${pm} install --ignore-scripts`;
  },

  buildDevCommand(pm, framework, _frameworkEntry, packageDevScript) {
    let flags = "";
    if (framework === "vite") flags = "--host";
    // Next 16 defaults to Turbopack. Don't inject --webpack:
    // 1) If the dev script already has --turbopack, appending --webpack causes
    //    "Multiple bundler flags set" and the dev server exits immediately.
    // 2) Even without a conflict, forcing --webpack on Next 16 breaks HMR
    //    (/_next/webpack-hmr returns 500).
    // If a project genuinely needs webpack, the user can add --webpack to their
    // own dev script - which is executed as-is via `<pm> run dev`.

    // Skip flags that are already present in the package.json dev script.
    if (flags && packageDevScript?.includes(flags)) {
      flags = "";
    }

    if (!flags) return `${pm} run dev`;
    return pm === "npm"
      ? `${pm} run dev -- ${flags}`
      : `${pm} run dev ${flags}`;
  },

  async patchConfig(sandbox, framework, rootDir) {
    if (framework === "vite") {
      await patchViteConfigForHostBinding(sandbox, rootDir);
      return;
    }

    if (framework === "next16") {
      await patchNextConfigForAllowedDevOrigins(sandbox, rootDir);
    }
  },
};

async function patchViteConfigForHostBinding(
  sandbox: Sandbox,
  rootDir?: string | null
) {
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      buildShellCommand(
        String.raw`for cfg in vite.config.js vite.config.ts vite.config.mjs vite.config.mts; do
  if [ -f "$cfg" ]; then
    if grep -q "host:" "$cfg"; then
      break
    elif grep -q "server:" "$cfg"; then
      sed -i "s/server:[[:space:]]*{/server: { host: true,/" "$cfg"
    else
      sed -i "/export default/a\  server: { host: true }," "$cfg"
    fi
    break
  fi
done`,
        rootDir
      ),
    ],
  });
}

async function patchNextConfigForAllowedDevOrigins(
  sandbox: Sandbox,
  rootDir?: string | null
) {
  for (const candidate of NEXT_CONFIG_CANDIDATES) {
    const path = resolveSandboxPath(rootDir, candidate);
    const buffer = await sandbox.readFileToBuffer({ path });
    if (!buffer) continue;

    const result = patchNextConfigContent(buffer.toString("utf-8"));
    if (result.kind === "patched") {
      await sandbox.writeFiles([
        { path, content: Buffer.from(result.content, "utf-8") },
      ]);
    }
    return;
  }

  const fallbackPath = resolveSandboxPath(rootDir, "next.config.mjs");
  await sandbox.writeFiles([
    {
      path: fallbackPath,
      content: Buffer.from(buildStandaloneNextConfig(), "utf-8"),
    },
  ]);
}

/** Also used for node24 - same logic, different runtime id. */
export const node24Strategy: RuntimeStrategy = {
  ...nodeStrategy,
  id: "node24",
  name: "Node.js 24",
};

async function detectNodePackageManager(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<{ pm: string; installFromRoot: boolean }> {
  // Step 1: Check lockfiles in the subdirectory
  const [hasYarnLock, hasPnpmLock, hasBunLock, hasNpmLock, hasBunTextLock] =
    await Promise.all([
      sandbox.readFile({ path: resolveSandboxPath(rootDir, "yarn.lock") }),
      sandbox.readFile({ path: resolveSandboxPath(rootDir, "pnpm-lock.yaml") }),
      sandbox.readFile({ path: resolveSandboxPath(rootDir, "bun.lockb") }),
      sandbox.readFile({
        path: resolveSandboxPath(rootDir, "package-lock.json"),
      }),
      sandbox.readFile({ path: resolveSandboxPath(rootDir, "bun.lock") }),
    ]);

  if (hasPnpmLock) return { pm: "pnpm", installFromRoot: false };
  if (hasYarnLock) return { pm: "yarn", installFromRoot: false };
  if (hasBunLock || hasBunTextLock)
    return { pm: "bun", installFromRoot: false };
  if (hasNpmLock) return { pm: "npm", installFromRoot: false };

  // Step 2: If rootDir is set and no lockfile found in subdir, check repo root
  const normalizedRoot = normalizeRootDirectory(rootDir);
  if (normalizedRoot) {
    const [rootYarn, rootPnpm, rootBun, rootNpm, rootBunText] =
      await Promise.all([
        sandbox.readFile({ path: "yarn.lock" }),
        sandbox.readFile({ path: "pnpm-lock.yaml" }),
        sandbox.readFile({ path: "bun.lockb" }),
        sandbox.readFile({ path: "package-lock.json" }),
        sandbox.readFile({ path: "bun.lock" }),
      ]);

    if (rootPnpm) return { pm: "pnpm", installFromRoot: true };
    if (rootYarn) return { pm: "yarn", installFromRoot: true };
    if (rootBun || rootBunText) return { pm: "bun", installFromRoot: true };
    if (rootNpm) return { pm: "npm", installFromRoot: true };
  }

  return { pm: "npm", installFromRoot: false };
}

/**
 * Read the target package.json and detect whether it depends on any
 * workspace packages (via `workspace:*` / `workspace:^` / `workspace:~`).
 * Returns the package name (if any) so the caller can build a filter
 * command like `pnpm --filter '<name>^...' run build`.
 */
export async function detectWorkspaceDependencies(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<{ packageName: string | null; hasWorkspaceDeps: boolean }> {
  const pkgPath = resolveSandboxPath(rootDir, "package.json");
  try {
    const raw = await readTextFile(sandbox, pkgPath);
    if (!raw) return { packageName: null, hasWorkspaceDeps: false };
    const parsed = JSON.parse(raw) as {
      name?: unknown;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };
    const packageName = typeof parsed.name === "string" ? parsed.name : null;
    const depGroups = [
      parsed.dependencies,
      parsed.devDependencies,
      parsed.peerDependencies,
      parsed.optionalDependencies,
    ];
    const hasWorkspaceDeps = depGroups.some((group) => {
      if (!group || typeof group !== "object") return false;
      return Object.values(group).some(
        (value) => typeof value === "string" && value.startsWith("workspace:")
      );
    });
    return { packageName, hasWorkspaceDeps };
  } catch {
    return { packageName: null, hasWorkspaceDeps: false };
  }
}

/** Secondary validation: check for workspace config at repo root. */
export async function detectWorkspaceRoot(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<boolean> {
  const normalizedRoot = normalizeRootDirectory(rootDir);
  if (!normalizedRoot) return false;

  const [pnpmWorkspace, turboJson] = await Promise.all([
    sandbox.readFile({ path: "pnpm-workspace.yaml" }),
    sandbox.readFile({ path: "turbo.json" }),
  ]);

  if (pnpmWorkspace || turboJson) return true;

  try {
    const rootPkgText = await readTextFile(sandbox, "package.json");
    if (rootPkgText) {
      const parsed = JSON.parse(rootPkgText);
      if (Array.isArray(parsed.workspaces)) return true;
    }
  } catch {
    // ignore parse errors
  }

  return false;
}

async function detectNodeFramework(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<string | undefined> {
  const pkgPath = resolveSandboxPath(rootDir, "package.json");
  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null = null;
  try {
    const raw = await readTextFile(sandbox, pkgPath);
    if (raw) packageJson = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const hasVite =
    packageJson?.dependencies?.vite || packageJson?.devDependencies?.vite;
  const nextVersion =
    packageJson?.dependencies?.next || packageJson?.devDependencies?.next || "";
  // Intentionally matches only exact/caret/tilde prefixes for v16 (e.g.
  // "16.x", "^16.0", "~16.1"). Complex range expressions like ">=16" or
  // ">=15 <17" are excluded - they're rare in practice and would require a
  // full semver range parser to handle correctly.
  const isNext16 =
    nextVersion.startsWith("16.") ||
    nextVersion.startsWith("^16.") ||
    nextVersion.startsWith("~16.");

  if (isNext16) return "next16";
  if (hasVite) return "vite";
  if (nextVersion) return "next";
  return undefined;
}
