const MONOREPO_MARKERS = [
  "pnpm-workspace.yaml",
  "turbo.json",
  "lerna.json",
  "nx.json",
  "rush.json",
];

const WORKSPACE_DIRS = ["apps", "packages", "services", "libs", "tools"];

export type WorkspaceEntry = {
  path: string;
  name: string;
  hasPackageJson: boolean;
  framework?: string | null;
};

export type MonorepoStructure = {
  is_monorepo: boolean;
  marker?: string | null;
  workspaces: WorkspaceEntry[];
};

async function githubHead(
  repoFullName: string,
  path: string,
  ref: string,
  token: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
      {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function githubGetJson<T>(
  repoFullName: string,
  path: string,
  ref: string,
  token: string
): Promise<T | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3.raw+json",
        },
      }
    );
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function githubGetText(
  repoFullName: string,
  path: string,
  ref: string,
  token: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3.raw",
        },
      }
    );
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

async function githubListDir(
  repoFullName: string,
  path: string,
  ref: string,
  token: string
): Promise<Array<{ name: string; type: string }> | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function detectFramework(
  repoFullName: string,
  dir: string,
  ref: string,
  token: string
): Promise<string | null> {
  const pkg = await githubGetJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(repoFullName, `${dir}/package.json`, ref, token);
  if (!pkg) return null;

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return "next";
  if (deps.nuxt) return "nuxt";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  if (deps.astro) return "astro";
  if (deps.remix || deps["@remix-run/react"]) return "remix";
  if (deps.vite) return "vite";
  if (deps.react) return "react";
  if (deps.vue) return "vue";
  if (deps["@angular/core"]) return "angular";
  if (deps["solid-start"] || deps["@solidjs/start"]) return "solid";
  if (deps.gatsby) return "gatsby";
  if (deps["@docusaurus/core"]) return "docusaurus";
  if (deps.express) return "express";
  if (deps.fastify) return "fastify";
  if (deps.hono) return "hono";
  return null;
}

export function parsePnpmWorkspaceGlobs(text: string): string[] {
  const globs: string[] = [];
  const lines = text.split(/\r?\n/);
  let inPackages = false;
  let sectionIndent = 0;

  for (const line of lines) {
    if (!inPackages) {
      const match = /^(\s*)packages:\s*$/.exec(line);
      if (match) {
        inPackages = true;
        sectionIndent = match[1]?.length ?? 0;
      }
      continue;
    }

    if (!line.trim() || line.trim().startsWith("#")) continue;

    const indent = /^\s*/.exec(line)![0].length;
    if (indent <= sectionIndent && !/^\s*-/.test(line)) {
      break;
    }

    const itemMatch = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (!itemMatch) continue;

    let value = itemMatch[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value) globs.push(value);
  }

  return globs;
}

function normalizeWorkspaceScanDir(glob: string): string | null {
  const normalized = glob
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/\/\*\*?$/, "")
    .replace(/\/+$/, "");

  if (!normalized || normalized === ".") return null;
  return normalized;
}

async function addWorkspaceEntry(
  workspaces: WorkspaceEntry[],
  seenPaths: Set<string>,
  repoFullName: string,
  path: string,
  ref: string,
  token: string
) {
  if (seenPaths.has(path)) return;

  const framework = await detectFramework(repoFullName, path, ref, token);
  workspaces.push({
    path,
    name: path.split("/").findLast(Boolean) || path,
    hasPackageJson: true,
    framework,
  });
  seenPaths.add(path);
}

export async function detectMonorepoStructure(
  repoFullName: string,
  githubToken: string,
  branch?: string
): Promise<MonorepoStructure> {
  const ref = branch || "main";

  // Check for monorepo markers at root
  const markerChecks = await Promise.all(
    MONOREPO_MARKERS.map(async (marker) => ({
      marker,
      exists: await githubHead(repoFullName, marker, ref, githubToken),
    }))
  );
  const foundMarker = markerChecks.find((m) => m.exists)?.marker || null;

  // Check root package.json for workspaces field
  let workspaceGlobs: string[] = [];
  const rootPkg = await githubGetJson<{
    workspaces?: string[] | { packages?: string[] };
  }>(repoFullName, "package.json", ref, githubToken);

  if (rootPkg?.workspaces) {
    if (Array.isArray(rootPkg.workspaces)) {
      workspaceGlobs = rootPkg.workspaces;
    } else if (Array.isArray(rootPkg.workspaces.packages)) {
      workspaceGlobs = rootPkg.workspaces.packages;
    }
  }

  if (workspaceGlobs.length === 0 && foundMarker === "pnpm-workspace.yaml") {
    const pnpmWorkspaceText = await githubGetText(
      repoFullName,
      "pnpm-workspace.yaml",
      ref,
      githubToken
    );
    if (pnpmWorkspaceText) {
      workspaceGlobs = parsePnpmWorkspaceGlobs(pnpmWorkspaceText);
    }
  }

  const is_monorepo = Boolean(foundMarker || workspaceGlobs.length > 0);
  if (!is_monorepo) {
    return { is_monorepo: false, workspaces: [] };
  }

  const workspaces: WorkspaceEntry[] = [];
  const seenPaths = new Set<string>();
  const workspacePatterns =
    workspaceGlobs.length > 0
      ? workspaceGlobs
          .map((glob) => ({
            raw: glob,
            scanDir: normalizeWorkspaceScanDir(glob),
            direct: !glob.includes("*"),
          }))
          .filter(
            (
              pattern
            ): pattern is { raw: string; scanDir: string; direct: boolean } =>
              Boolean(pattern.scanDir)
          )
      : WORKSPACE_DIRS.map((dir) => ({
          raw: `${dir}/*`,
          scanDir: dir,
          direct: false,
        }));

  for (const pattern of workspacePatterns) {
    if (pattern.direct) {
      const hasPkg = await githubHead(
        repoFullName,
        `${pattern.scanDir}/package.json`,
        ref,
        githubToken
      );
      if (hasPkg) {
        await addWorkspaceEntry(
          workspaces,
          seenPaths,
          repoFullName,
          pattern.scanDir,
          ref,
          githubToken
        );
      }
      continue;
    }

    const contents = await githubListDir(
      repoFullName,
      pattern.scanDir,
      ref,
      githubToken
    );
    if (!contents) continue;

    const subdirs = contents.filter((item) => item.type === "dir");
    for (const item of subdirs) {
      const wsPath = `${pattern.scanDir}/${item.name}`;
      const hasPkg = await githubHead(
        repoFullName,
        `${wsPath}/package.json`,
        ref,
        githubToken
      );
      if (!hasPkg) continue;
      await addWorkspaceEntry(
        workspaces,
        seenPaths,
        repoFullName,
        wsPath,
        ref,
        githubToken
      );
    }
  }

  return { is_monorepo: true, marker: foundMarker, workspaces };
}
