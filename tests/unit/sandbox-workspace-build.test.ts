import assert from "node:assert/strict";
import test from "node:test";

async function loadNodeRuntime() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/runtimes/node");
}

test("buildWorkspaceDepsBuildCommand emits pnpm filter with transitive-deps selector", async () => {
  const { buildWorkspaceDepsBuildCommand } = await loadNodeRuntime();
  const cmd = buildWorkspaceDepsBuildCommand("pnpm", "credit-renew-actor");
  assert.equal(
    cmd,
    "pnpm --filter 'credit-renew-actor^...' run --if-present build"
  );
});

test("buildWorkspaceDepsBuildCommand escapes single quotes in scoped package names", async () => {
  const { buildWorkspaceDepsBuildCommand } = await loadNodeRuntime();
  const cmd = buildWorkspaceDepsBuildCommand("pnpm", "@memories.sh/web");
  assert.equal(
    cmd,
    "pnpm --filter '@memories.sh/web^...' run --if-present build"
  );
});

test("buildWorkspaceDepsBuildCommand returns yarn workspaces foreach for yarn", async () => {
  const { buildWorkspaceDepsBuildCommand } = await loadNodeRuntime();
  const cmd = buildWorkspaceDepsBuildCommand("yarn", "my-app");
  assert.match(cmd ?? "", /yarn workspaces foreach --from 'my-app'/);
  assert.match(cmd ?? "", /--topological -R run build/);
});

test("buildWorkspaceDepsBuildCommand returns null for npm and bun (no reliable deps-of filter)", async () => {
  const { buildWorkspaceDepsBuildCommand } = await loadNodeRuntime();
  assert.equal(buildWorkspaceDepsBuildCommand("npm", "my-app"), null);
  assert.equal(buildWorkspaceDepsBuildCommand("bun", "my-app"), null);
});

test("buildWorkspaceDepsBuildCommand returns null when packageName is empty", async () => {
  const { buildWorkspaceDepsBuildCommand } = await loadNodeRuntime();
  assert.equal(buildWorkspaceDepsBuildCommand("pnpm", ""), null);
});

function makeFakeSandbox(pkgJson: object | null) {
  return {
    readFile: async () => null,
    readFileToBuffer: async ({ path }: { path: string }) => {
      if (path === "package.json" && pkgJson) {
        return Buffer.from(JSON.stringify(pkgJson));
      }
      return null;
    },
  };
}

test("detectWorkspaceDependencies flags packages with workspace:* deps", async () => {
  const { detectWorkspaceDependencies } = await loadNodeRuntime();
  const sandbox = makeFakeSandbox({
    name: "credit-renew-actor",
    dependencies: {
      "@credit-renew/shared": "workspace:*",
      zod: "^3.0.0",
    },
  });
  const result = await detectWorkspaceDependencies(sandbox as never);
  assert.equal(result.packageName, "credit-renew-actor");
  assert.equal(result.hasWorkspaceDeps, true);
});

test("detectWorkspaceDependencies returns false for apps with no workspace deps (memories/web case)", async () => {
  const { detectWorkspaceDependencies } = await loadNodeRuntime();
  const sandbox = makeFakeSandbox({
    name: "@memories.sh/web",
    dependencies: { next: "16.2.3", react: "19.2.4" },
    devDependencies: { typescript: "^5" },
  });
  const result = await detectWorkspaceDependencies(sandbox as never);
  assert.equal(result.packageName, "@memories.sh/web");
  assert.equal(result.hasWorkspaceDeps, false);
});

test("detectWorkspaceDependencies detects workspace deps across all dependency groups", async () => {
  const { detectWorkspaceDependencies } = await loadNodeRuntime();
  const sandbox = makeFakeSandbox({
    name: "pkg",
    peerDependencies: { "@scope/peer": "workspace:^" },
  });
  const result = await detectWorkspaceDependencies(sandbox as never);
  assert.equal(result.hasWorkspaceDeps, true);
});

test("detectWorkspaceDependencies handles missing package.json without throwing", async () => {
  const { detectWorkspaceDependencies } = await loadNodeRuntime();
  const sandbox = makeFakeSandbox(null);
  const result = await detectWorkspaceDependencies(sandbox as never);
  assert.equal(result.packageName, null);
  assert.equal(result.hasWorkspaceDeps, false);
});

test("detectWorkspaceDependencies handles malformed package.json without throwing", async () => {
  const { detectWorkspaceDependencies } = await loadNodeRuntime();
  const sandbox = {
    readFile: async () => null,
    readFileToBuffer: async () => Buffer.from("{ this is not json"),
  };
  const result = await detectWorkspaceDependencies(sandbox as never);
  assert.equal(result.packageName, null);
  assert.equal(result.hasWorkspaceDeps, false);
});

/**
 * Build a fake sandbox where each path returns a package.json or a workspace
 * marker file. Paths not in the map return null. `listedDirs` lets tests
 * simulate `find <dir> -maxdepth 1 -type d` output.
 */
function makeMonorepoSandbox(
  files: Record<string, object | string | null>,
  listedDirs: Record<string, string[]> = {}
) {
  const runCommandCalls: string[] = [];
  return {
    runCommandCalls,
    readFile: async ({ path }: { path: string }) => {
      if (path in files && files[path] !== null) return Buffer.from("present");
      return null;
    },
    readFileToBuffer: async ({ path }: { path: string }) => {
      const value = files[path];
      if (value == null) return null;
      if (typeof value === "string") return Buffer.from(value);
      return Buffer.from(JSON.stringify(value));
    },
    runCommand: async ({ args }: { cmd: string; args: string[] }) => {
      const script = args[args.length - 1] || "";
      runCommandCalls.push(script);
      // Parse the `find '<dir>' -maxdepth 1 -mindepth 1 -type d ...` command
      const match = /find '([^']+)' -maxdepth 1/.exec(script);
      const dir = match?.[1] || "";
      const listing = listedDirs[dir] || [];
      return {
        stdout: async () => listing.join("\n"),
      };
    },
  };
}

test("resolveMonorepoWebTarget returns null when repo root is not a monorepo", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  // No pnpm-workspace.yaml, no turbo.json, no workspaces field → not a monorepo.
  const sandbox = makeMonorepoSandbox({
    "package.json": { name: "single-app", dependencies: { next: "^16" } },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.equal(result, null);
});

test("resolveMonorepoWebTarget returns null when the monorepo root is itself a Next.js app", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "package.json": {
      name: "root-next",
      scripts: { dev: "next dev" },
      dependencies: { next: "^16" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.equal(result, null);
});

test("resolveMonorepoWebTarget auto-selects web/ for credit-renew-style monorepos", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "pnpm-workspace.yaml": 'packages:\n  - "."\n  - "web"\n  - "packages/*"\n',
    "package.json": {
      name: "credit-renew-actor",
      scripts: { dev: "tsx src/main.ts" },
      dependencies: { apify: "^3", playwright: "^1" },
    },
    "web/package.json": {
      name: "credit-renew-web",
      scripts: { dev: "next dev --port 3003" },
      dependencies: { next: "16.2.3", react: "19.2.0" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "web", framework: "next" });
});

test("resolveMonorepoWebTarget auto-selects packages/web for memories-style monorepos", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "package.json": {
      name: "root-workspace",
      // No dev script at root → definitely not a web app.
      scripts: { build: "pnpm -r build" },
    },
    "packages/web/package.json": {
      name: "@memories.sh/web",
      scripts: { dev: "next dev" },
      dependencies: { next: "16.2.3" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "packages/web", framework: "next" });
});

test("resolveMonorepoWebTarget scans apps/ and packages/ when common paths miss, preferring Next over Vite", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox(
    {
      "turbo.json": "{}",
      "package.json": { name: "root", scripts: { build: "turbo run build" } },
      "apps/marketing/package.json": {
        name: "marketing",
        scripts: { dev: "vite" },
        dependencies: { vite: "^5" },
      },
      "apps/dashboard/package.json": {
        name: "dashboard",
        scripts: { dev: "next dev" },
        dependencies: { next: "^16" },
      },
    },
    {
      apps: ["apps/marketing", "apps/dashboard"],
      packages: [],
      services: [],
    }
  );
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "apps/dashboard", framework: "next" });
});

test("resolveMonorepoWebTarget returns null when no workspace is a web app", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox(
    {
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "package.json": { name: "root", scripts: { build: "pnpm -r build" } },
      "packages/core/package.json": {
        name: "core",
        scripts: { build: "tsup" },
      },
    },
    { packages: ["packages/core"], apps: [], services: [] }
  );
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.equal(result, null);
});

// --- New marker detection tests ---

test("resolveMonorepoWebTarget detects Lerna monorepos via lerna.json", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "lerna.json": JSON.stringify({ packages: ["packages/*"] }),
    "package.json": { name: "root", scripts: { build: "lerna run build" } },
    "web/package.json": {
      name: "my-web",
      scripts: { dev: "next dev" },
      dependencies: { next: "^16" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "web", framework: "next" });
});

test("resolveMonorepoWebTarget detects Nx monorepos via nx.json", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox(
    {
      "nx.json": "{}",
      "package.json": {
        name: "root",
        workspaces: ["apps/*", "libs/*"],
      },
      "apps/portal/package.json": {
        name: "portal",
        scripts: { dev: "next dev" },
        dependencies: { next: "^16" },
      },
    },
    { apps: ["apps/portal"], libs: [], packages: [], services: [] }
  );
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "apps/portal", framework: "next" });
});

test("resolveMonorepoWebTarget detects Rush monorepos via rush.json", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "rush.json": "{}",
    "package.json": { name: "root" },
    "app/package.json": {
      name: "my-app",
      scripts: { dev: "vite" },
      dependencies: { vite: "^5", react: "^19" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "app", framework: "vite" });
});

// --- Workspace-config-aware scanning tests ---

test("resolveMonorepoWebTarget scans workspace dirs from lerna.json packages config", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox(
    {
      "lerna.json": JSON.stringify({ packages: ["modules/*"] }),
      "package.json": { name: "root" },
      "modules/dashboard/package.json": {
        name: "dashboard",
        scripts: { dev: "next dev" },
        dependencies: { next: "^16" },
      },
    },
    { modules: ["modules/dashboard"], apps: [], packages: [], services: [] }
  );
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "modules/dashboard", framework: "next" });
});

test("resolveMonorepoWebTarget probes direct workspace paths from config", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  // pnpm workspace with a direct path "dashboard" (not a glob)
  const sandbox = makeMonorepoSandbox({
    "pnpm-workspace.yaml": 'packages:\n  - "dashboard"\n  - "packages/*"\n',
    "package.json": { name: "root", scripts: { build: "pnpm -r build" } },
    "dashboard/package.json": {
      name: "my-dashboard",
      scripts: { dev: "next dev" },
      dependencies: { next: "^16" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "dashboard", framework: "next" });
});

// --- Dev script requirement test ---

test("resolveMonorepoWebTarget skips web packages without a dev script", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "pnpm-workspace.yaml": 'packages:\n  - "web"\n  - "packages/*"\n',
    "package.json": { name: "root", scripts: { build: "pnpm -r build" } },
    // web/ has Next.js but NO dev script — shouldn't be auto-selected.
    "web/package.json": {
      name: "web-lib",
      scripts: { build: "next build" },
      dependencies: { next: "^16" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.equal(result, null);
});

test("resolveMonorepoWebTarget prefers workspace with dev script over one without", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox(
    {
      "turbo.json": "{}",
      "package.json": { name: "root", scripts: { build: "turbo run build" } },
      // apps/storybook has Next.js but no dev script.
      "apps/storybook/package.json": {
        name: "storybook",
        scripts: { build: "next build" },
        dependencies: { next: "^16" },
      },
      // apps/web has Vite with a dev script — should be picked despite lower priority.
      "apps/web-app/package.json": {
        name: "web-app",
        scripts: { dev: "vite" },
        dependencies: { vite: "^5" },
      },
    },
    {
      apps: ["apps/storybook", "apps/web-app"],
      packages: [],
      services: [],
    }
  );
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "apps/web-app", framework: "vite" });
});

// --- New framework detection tests ---

test("resolveMonorepoWebTarget detects Angular workspaces", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "nx.json": "{}",
    "package.json": { name: "root" },
    "app/package.json": {
      name: "my-angular-app",
      scripts: { dev: "ng serve" },
      dependencies: { "@angular/core": "^18" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "app", framework: "angular" });
});

test("resolveMonorepoWebTarget detects Gatsby workspaces", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "lerna.json": "{}",
    "package.json": { name: "root" },
    "web/package.json": {
      name: "my-gatsby-site",
      scripts: { dev: "gatsby develop" },
      dependencies: { gatsby: "^5" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "web", framework: "gatsby" });
});

test("resolveMonorepoWebTarget detects Docusaurus workspaces", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "pnpm-workspace.yaml": "packages:\n  - docs\n  - packages/*\n",
    "package.json": { name: "root", scripts: { build: "pnpm -r build" } },
    "docs/package.json": {
      name: "my-docs",
      scripts: { dev: "docusaurus start" },
      dependencies: { "@docusaurus/core": "^3" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "docs", framework: "docusaurus" });
});

test("resolveMonorepoWebTarget detects SolidStart workspaces", async () => {
  const { resolveMonorepoWebTarget } = await loadNodeRuntime();
  const sandbox = makeMonorepoSandbox({
    "pnpm-workspace.yaml": "packages:\n  - app\n  - packages/*\n",
    "package.json": { name: "root", scripts: { build: "pnpm -r build" } },
    "app/package.json": {
      name: "my-solid-app",
      scripts: { dev: "solid-start dev" },
      dependencies: { "@solidjs/start": "^1" },
    },
  });
  const result = await resolveMonorepoWebTarget(sandbox as never);
  assert.deepEqual(result, { path: "app", framework: "solid" });
});
