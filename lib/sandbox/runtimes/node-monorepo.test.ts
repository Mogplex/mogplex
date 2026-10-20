import { expect, it } from "vitest";
import type { RepositoryFiles } from "../repository-files";
import { resolveMonorepoWebTargetFromFiles } from "./node-monorepo";

const web = (framework = "next") =>
  JSON.stringify({
    dependencies: { [framework]: "1" },
    scripts: { dev: `${framework} dev` },
  });

function repository(contents: Record<string, string>): RepositoryFiles {
  return {
    readText: async (path) => contents[path] ?? null,
    listDirectories: async (path) => {
      const prefix = path ? `${path}/` : "";
      return [
        ...new Set(
          Object.keys(contents)
            .filter((file) => file.startsWith(prefix))
            .map((file) => file.slice(prefix.length).split("/"))
            .filter((parts) => parts.length > 1)
            .map((parts) => parts[0])
        ),
      ].reverse();
    },
  };
}

it.each<{ name: string; files: Record<string, string> }>([
  { name: "mixed Python and web repository", files: { "etl/main.py": "" } },
  { name: "Python root", files: { "pyproject.toml": "[project]" } },
  { name: "missing root manifest", files: {} },
  { name: "malformed root manifest", files: { "package.json": "{" } },
])("discovers web/ in a $name without workspace markers", async ({ files }) => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({ ...files, "web/package.json": web() })
    )
  ).toEqual({ path: "web", framework: "next" });
});

it("finds a custom immediate directory and ignores generated packages", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "node_modules/next/package.json": web(),
        ".next/package.json": web(),
        "customer portal/package.json": web("vite"),
      })
    )
  ).toEqual({ path: "customer portal", framework: "vite" });
});

it.each([
  ["pnpm-workspace.yaml", 'packages: ["products/*/ui", "!products/old/**"]'],
  [
    "package.json",
    JSON.stringify({
      workspaces: { packages: ["products/*/ui", "!products/old/**"] },
    }),
  ],
  [
    "lerna.json",
    JSON.stringify({ packages: ["products/*/ui", "!products/old/**"] }),
  ],
])(
  "expands nested workspace paths from %s and honors exclusions",
  async (config, content) => {
    expect(
      await resolveMonorepoWebTargetFromFiles(
        repository({
          [config]: content,
          "products/old/ui/package.json": web(),
          "products/current/ui/package.json": web("vite"),
        })
      )
    ).toEqual({ path: "products/current/ui", framework: "vite" });
  }
);

it("honors exclusions even for common web/ paths", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "pnpm-workspace.yaml": "packages:\n  - '*'\n  - '!web' # legacy app\n",
        "web/package.json": web(),
        "frontend/package.json": web("vite"),
      })
    )
  ).toEqual({ path: "frontend", framework: "vite" });
});

it("excludes descendants of a legacy workspace directory", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "pnpm-workspace.yaml": "packages: ['packages/**', '!packages/legacy']",
        "packages/legacy/web/package.json": web(),
        "packages/legacy/app/package.json": web(),
        "packages/current/ui/package.json": web("vite"),
      })
    )
  ).toEqual({ path: "packages/current/ui", framework: "vite" });
});

it("supports globstars and braces without traversing dependencies", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "package.json": JSON.stringify({
          workspaces: ["{products,clients}/**"],
        }),
        "products/group/dashboard/package.json": web("vite"),
        "clients/node_modules/copied/package.json": web(),
      })
    )
  ).toEqual({ path: "products/group/dashboard", framework: "vite" });
});

it.each([
  [
    "nx.json",
    JSON.stringify({ workspaceLayout: { appsDir: "products" } }),
    "products/portal",
  ],
  [
    "rush.json",
    JSON.stringify({ projects: [{ projectFolder: "custom/nested/portal" }] }),
    "custom/nested/portal",
  ],
])("uses app locations declared by %s", async (config, content, directory) => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({ [config]: content, [`${directory}/package.json`]: web() })
    )
  ).toEqual({ path: directory, framework: "next" });
});

it("keeps a runnable root web app ahead of nested apps", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({ "package.json": web("vite"), "web/package.json": web() })
    )
  ).toBeNull();
});

it("does not mistake root framework tooling for a runnable root app", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "package.json": JSON.stringify({ devDependencies: { next: "16" } }),
        "web/package.json": web(),
      })
    )
  ).toEqual({ path: "web", framework: "next" });
});

it("ignores blank dev scripts at the repository root", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "package.json": JSON.stringify({
          dependencies: { next: "16" },
          scripts: { dev: "  " },
        }),
        "web/package.json": web(),
      })
    )
  ).toEqual({ path: "web", framework: "next" });
});

it("breaks equal framework ties by path regardless of directory listing order", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({ "beta/package.json": web(), "alpha/package.json": web() })
    )
  ).toEqual({ path: "alpha", framework: "next" });
});

it("does not select libraries or invent a web app when none exists", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "tools/package.json": JSON.stringify({
          scripts: { dev: "tsx cli.ts" },
        }),
        "web/package.json": JSON.stringify({ dependencies: { react: "19" } }),
      })
    )
  ).toBeNull();
});

it("propagates repository access errors", async () => {
  const files = repository({});
  files.readText = async () => {
    throw new Error("GitHub 403");
  };
  await expect(resolveMonorepoWebTargetFromFiles(files)).rejects.toThrow(
    "GitHub 403"
  );
});

it("uses a complete package index to find deeply nested apps without directory fan-out", async () => {
  const files = repository({
    "pnpm-workspace.yaml": "packages: ['products/**']",
    "products/department/project/ui/package.json": web(),
  });
  files.listPackageDirectories = async () => ["products/department/project/ui"];
  files.listDirectories = async () => {
    throw new Error("must use package index");
  };
  expect(await resolveMonorepoWebTargetFromFiles(files)).toEqual({
    path: "products/department/project/ui",
    framework: "next",
  });
});

it.each([
  {
    files: { "web/package.json": web() },
    expected: { path: "web", framework: "next" },
  },
  { files: { "web/package.json": "{}" }, expected: null },
  {
    files: {
      "pnpm-workspace.yaml": "packages: ['*', '!web']",
      "web/package.json": web(),
      "frontend/package.json": web("vite"),
    },
    expected: { path: "frontend", framework: "vite" },
  },
])(
  "selects indexed common paths and respects exclusions and non-apps",
  async ({ files, expected }) => {
    const contents = Object.fromEntries(
      Object.entries(files).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
    const source = repository(contents);
    source.listPackageDirectories = async () =>
      Object.keys(contents)
        .filter((path) => path.endsWith("/package.json"))
        .map((path) => path.slice(0, -13));
    source.listDirectories = async () => {
      throw new Error("must use complete package index");
    };
    expect(await resolveMonorepoWebTargetFromFiles(source)).toEqual(expected);
  }
);

it("skips web/config probes for repositories with no package manifests", async () => {
  const reads: string[] = [];
  const files: RepositoryFiles = {
    readText: async (path) => {
      reads.push(path);
      return null;
    },
    listDirectories: async () => {
      throw new Error("must use package index");
    },
    listPackageDirectories: async () => [],
  };
  expect(await resolveMonorepoWebTargetFromFiles(files)).toBeNull();
  expect(reads).toEqual(["package.json"]);
});

it("falls back to directory discovery when a package index is truncated", async () => {
  const files = repository({ "web/package.json": web() });
  files.listPackageDirectories = async () => null;
  expect(await resolveMonorepoWebTargetFromFiles(files)).toEqual({
    path: "web",
    framework: "next",
  });
});

it("reads commented Rush config with trailing commas", async () => {
  expect(
    await resolveMonorepoWebTargetFromFiles(
      repository({
        "rush.json":
          '{ // projects\n "projects": [{"projectFolder":"custom/nested/portal"},], }',
        "custom/nested/portal/package.json": web(),
      })
    )
  ).toEqual({ path: "custom/nested/portal", framework: "next" });
});

it("ignores invalid optional metadata and unsafe workspace paths", async () => {
  const files = repository({
    "pnpm-workspace.yaml": "[invalid",
    "lerna.json": "{",
    "package.json": JSON.stringify({
      workspaces: [
        null,
        5,
        "../external",
        "/absolute",
        ".",
        "C:/outside",
        "./products//current/../portal/",
      ],
    }),
    "products/portal/package.json": web(),
    "../external/package.json": web(),
  });
  expect(await resolveMonorepoWebTargetFromFiles(files)).toEqual({
    path: "products/portal",
    framework: "next",
  });
});

it("propagates directory listing failures", async () => {
  const files = repository({
    "package.json": JSON.stringify({ workspaces: ["products/*"] }),
  });
  files.listDirectories = async () => {
    throw new Error("directory inspection failed");
  };
  await expect(resolveMonorepoWebTargetFromFiles(files)).rejects.toThrow(
    "directory inspection failed"
  );
});
