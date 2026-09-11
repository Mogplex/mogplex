import { Sandbox } from "@vercel/sandbox";
import { afterEach, expect, it, vi } from "vitest";
import { detectGithubDevPort } from "./dev-port";
import { githubRepositoryFiles } from "./repository-files";
import {
  createSandboxForRepo,
  createSandboxFromSnapshot,
} from "./client-lifecycle";
import {
  resolveSandboxLaunchRuntimePreparation,
  provisionSandboxForLaunch,
} from "@/app/api/sandbox/_lib/provisioning";
import type {
  SandboxLaunchPreparation,
  SandboxRepoRecord,
} from "@/app/api/sandbox/_lib/types";

const repoInput = {
  repoFullName: "acme/repo",
  githubToken: "fixture",
  ref: "feature/dev port",
};
function mockRepository(extra: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      dependencies: { next: "16" },
      scripts: { dev: "pnpm --filter @acme/web dev" },
    }),
    "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    "apps/web/package.json": JSON.stringify({
      name: "@acme/web",
      scripts: { dev: "next dev --port 3015" },
    }),
    "apps/admin/package.json": JSON.stringify({
      name: "@acme/admin",
      scripts: { dev: "next dev --port 4111" },
    }),
    ...extra,
  };
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "example.supabase.co") return Response.json([]);
      expect(url.hostname).toBe("api.github.com");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer fixture"
      );
      const path = decodeURIComponent(
        url.pathname.split("/contents/")[1] ?? ""
      );
      if (
        new Headers(init?.headers).get("Accept") ===
        "application/vnd.github.raw+json"
      ) {
        return new Response(files[path] ?? "missing", {
          status: path in files ? 200 : 404,
        });
      }
      const prefix = path ? `${path}/` : "";
      const names = [
        ...new Set(
          Object.keys(files)
            .filter((file) => file.startsWith(prefix))
            .map((file) => file.slice(prefix.length).split("/"))
            .filter((parts) => parts.length > 1)
            .map((parts) => parts[0])
        ),
      ];
      return Response.json(names.map((name) => ({ name, type: "dir" })));
    });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("inspects the requested ref and follows its workspace pin", async () => {
  const fetch = mockRepository();
  expect(await detectGithubDevPort(repoInput)).toBe(3015);
  for (const [url] of fetch.mock.calls)
    expect(new URL(String(url)).searchParams.get("ref")).toBe(repoInput.ref);
});

it("honors a manual port without any repository requests", async () => {
  const fetch = mockRepository();
  expect(await detectGithubDevPort({ ...repoInput, devPort: 4555 })).toBe(4555);
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the selected launch root and explicit command", async () => {
  mockRepository();
  expect(
    await detectGithubDevPort({ ...repoInput, rootDirectory: "apps/admin" })
  ).toBe(4111);
  expect(
    await detectGithubDevPort({ ...repoInput, devCommand: "next dev -p 4888" })
  ).toBe(4888);
});

it("matches automatic monorepo target selection before sandbox creation", async () => {
  mockRepository({
    "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
    "apps/web/package.json": JSON.stringify({
      name: "@acme/web",
      dependencies: { next: "16" },
      scripts: { dev: "next dev -p 3015" },
    }),
  });
  expect(await detectGithubDevPort(repoInput)).toBe(3015);
});

it("retains framework fallback when no static pin is present", async () => {
  mockRepository({
    "package.json": JSON.stringify({ scripts: { dev: "next dev" } }),
  });
  expect(await detectGithubDevPort(repoInput)).toBeNull();
});

it("distinguishes missing files from a GitHub access failure", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("missing", { status: 404 }));
  expect(await detectGithubDevPort(repoInput)).toBeNull();
  fetch.mockResolvedValue(new Response("denied", { status: 403 }));
  await expect(detectGithubDevPort(repoInput)).rejects.toThrow("GitHub 403");
});

it("caches repository reads while keeping their bodies readable", async () => {
  const fetch = mockRepository();
  const files = githubRepositoryFiles(repoInput);
  const first = await files.readText("package.json");
  expect(await files.readText("package.json")).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "exposes the detected port through actual launch provisioning (snapshot=%s)",
  async (snapshot) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture");
    vi.stubEnv("MOGPLEX_DATA_BACKEND", "supabase");
    const fetch = mockRepository();
    const repo = {
      id: "repo",
      full_name: "acme/repo",
      runtime: "node22",
      dev_port: 3000,
      dev_port_auto: true,
      snapshot_id: null,
    } as SandboxRepoRecord;
    const launchRequest = {
      repoId: "repo",
      baseBranch: "main",
      workingBranch: repoInput.ref,
      createBranch: !snapshot,
      rootDirectory: null,
      restoreSnapshotId: snapshot ? "snap_fixture" : null,
      restoreSnapshotProjectId: null,
      restoreSnapshotTeamId: null,
    };
    const preparation = await resolveSandboxLaunchRuntimePreparation({
      repo,
      githubToken: "fixture",
      launchRequest,
      userId: "fixture-user",
      productTeamId: null,
      effectiveRootDirectory: null,
    });
    expect(preparation.configuredDevPort).toBeNull();
    const vm = {
      domain: (port: number) => `https://preview-${port}.example.test`,
    } as Awaited<ReturnType<typeof Sandbox.create>>;
    const provider = vi.spyOn(Sandbox, "create").mockResolvedValue(vm);
    const launch = {
      ...preparation,
      repo,
      launchRequest,
      githubToken: "fixture",
      createContext: {
        credentials: { vercelToken: "fixture", vercelProjectId: "project" },
      },
    } as SandboxLaunchPreparation;
    const result = await provisionSandboxForLaunch({
      deps: { createSandboxForRepo, createSandboxFromSnapshot } as Parameters<
        typeof provisionSandboxForLaunch
      >[0]["deps"],
      launch,
      environment: {
        envResolution: { envVars: {} },
        networkPolicy: undefined,
      } as Parameters<typeof provisionSandboxForLaunch>[0]["environment"],
      emit: () => {},
      sandboxRecordId: "record",
    });
    expect(result.sandbox).toBe(vm);
    expect(result.devPort).toBe(3015);
    const githubCalls = fetch.mock.calls.filter(([url]) =>
      String(url).includes("api.github.com")
    );
    for (const [url] of githubCalls)
      expect(new URL(String(url)).searchParams.get("ref")).toBe(
        snapshot ? repoInput.ref : "main"
      );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0][0]).toMatchObject({
      ports: expect.arrayContaining([3015]),
      source: { type: snapshot ? "snapshot" : "git" },
    });
  }
);

it("uses a configured workspace outside common app directories", async () => {
  mockRepository({
    "package.json": JSON.stringify({ workspaces: ["ui/dashboard"] }),
    "pnpm-workspace.yaml": "packages:\n  - ui/dashboard\n",
    "apps/web/package.json": "{}",
    "apps/admin/package.json": "{}",
    "ui/dashboard/package.json": JSON.stringify({
      dependencies: { next: "16" },
      scripts: { dev: "next dev -p 4666" },
    }),
  });
  expect(await detectGithubDevPort(repoInput)).toBe(4666);
});

it("ignores non-directory and malformed GitHub directory entries", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json([
        { type: "dir", name: "web" },
        { type: "file", name: "package.json" },
        { type: "dir", name: 5 },
        null,
        3,
      ])
    );
  expect(
    await githubRepositoryFiles(repoInput).listDirectories("apps")
  ).toEqual(["web"]);
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Accept")).toBe(
    "application/vnd.github+json"
  );
  fetch.mockResolvedValue(new Response("missing", { status: 404 }));
  expect(
    await githubRepositoryFiles(repoInput).listDirectories("missing")
  ).toEqual([]);
  fetch.mockResolvedValue(Response.json({ message: "not a listing" }));
  expect(
    await githubRepositoryFiles(repoInput).listDirectories("apps")
  ).toEqual([]);
});
