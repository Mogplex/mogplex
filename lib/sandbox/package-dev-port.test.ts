import { describe, expect, it } from "vitest";
import { resolvePackageDevPort } from "./package-dev-port";
import type { RepositoryFiles } from "./repository-files";

function repository(
  rootDev: string,
  webDev = "next dev --port 3015",
  extra: Record<string, string> = {}
): RepositoryFiles {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      workspaces: ["apps/*"],
      scripts: { dev: rootDev, serve: "next dev -p 4123" },
    }),
    "apps/web/package.json": JSON.stringify({
      name: "@acme/web",
      scripts: { dev: webDev },
    }),
    "apps/admin/package.json": JSON.stringify({
      name: "@acme/admin",
      scripts: { dev: "next dev --port 3020" },
    }),
    ...extra,
  };
  return {
    readText: async (path) => files[path] ?? null,
    listDirectories: async (path) => [
      ...new Set(
        Object.keys(files)
          .filter((file) => file.startsWith(`${path}/`))
          .map((file) => file.slice(path.length + 1).split("/")[0])
      ),
    ],
  };
}

describe("pinned package dev ports", () => {
  it.each([
    ["next dev --port 3015", 3015],
    ["next dev -p 4001", 4001],
    ["vite --port=4200", 4200],
    ["next dev --port '4310'", 4310],
    ["PORT=5050 next dev", 5050],
    ['cross-env PORT="5051" next dev', 5051],
    ["PORT=5050 next dev --port 3015", 3015],
    ["npm run serve", 4123],
    ["pnpm run serve --port 4201", 4201],
    ["npm run serve --port 0", 4123],
    ["next dev --port 65536", null],
    ["next dev", null],
    ["node ./start.js", null],
    ["next dev --port $PORT", null],
    ["echo --port 4000 && next dev", null],
    ["npm run missing", null],
    ["npm run dev", null],
  ])("resolves %s to %s", async (command, expected) => {
    expect(await resolvePackageDevPort(repository(command), {})).toBe(expected);
  });

  it.each([
    "pnpm --filter @acme/web dev",
    "pnpm --filter='@acme/web' run dev",
    "pnpm -F @acme/web dev",
    "npm run dev --workspace @acme/web",
    "npm -w apps/web run dev",
    "yarn workspace @acme/web dev",
    "bun --filter @acme/web dev",
    "pnpm --dir apps/web dev",
    "pnpm -C apps/web dev",
    "npm --prefix apps/web run dev",
    "yarn --cwd apps/web dev",
    "bun --cwd apps/web run dev",
  ])("follows %s to the selected workspace", async (command) => {
    expect(await resolvePackageDevPort(repository(command), {})).toBe(3015);
  });

  it("uses pnpm workspace declarations and follows nested script aliases", async () => {
    const files = repository("pnpm --filter @acme/web dev", "pnpm run serve", {
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - '!apps/admin'\n",
      "apps/web/package.json": JSON.stringify({
        name: "@acme/web",
        scripts: { dev: "pnpm run serve", serve: "next dev --port 4567" },
      }),
    });
    expect(await resolvePackageDevPort(files, {})).toBe(4567);
  });

  it("reads the launch root and explicit command instead of an unrelated root script", async () => {
    const files = repository("next dev --port 3000");
    expect(
      await resolvePackageDevPort(files, { rootDirectory: "apps/web" })
    ).toBe(3015);
    expect(
      await resolvePackageDevPort(files, { devCommand: "next dev --port 4111" })
    ).toBe(4111);
    expect(
      await resolvePackageDevPort(files, { devCommand: "node other.js" })
    ).toBeNull();
  });

  it("keeps CLI flags above inherited PORT, but inherits PORT when no CLI pin exists", async () => {
    expect(
      await resolvePackageDevPort(
        repository("PORT=5000 pnpm --filter @acme/web dev"),
        {}
      )
    ).toBe(3015);
    expect(
      await resolvePackageDevPort(
        repository("PORT=5000 pnpm --filter @acme/web dev", "next dev"),
        {}
      )
    ).toBe(5000);
  });

  it.each([
    "pnpm --filter '*' dev",
    "pnpm --filter @acme/web --filter @acme/admin dev",
    "npm --prefix ../../outside run dev",
    "pnpm --filter missing dev",
  ])("does not guess a target for %s", async (command) => {
    expect(await resolvePackageDevPort(repository(command), {})).toBeNull();
  });

  it("ignores excluded workspaces and terminates script cycles", async () => {
    expect(
      await resolvePackageDevPort(
        repository("pnpm --filter @acme/admin dev", undefined, {
          "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - '!apps/admin'\n",
        }),
        {}
      )
    ).toBeNull();
    expect(
      await resolvePackageDevPort(
        repository("npm run serve", undefined, {
          "package.json": JSON.stringify({
            scripts: { dev: "npm run serve", serve: "npm run dev" },
          }),
        }),
        {}
      )
    ).toBeNull();
  });
  it.each([
    "null",
    "[]",
    "invalid",
    '{"workspaces":{"packages":7},"scripts":{"dev":"pnpm --filter @acme/web dev"}}',
  ])("handles malformed package metadata: %s", async (raw) => {
    expect(
      await resolvePackageDevPort(
        repository("", undefined, { "package.json": raw }),
        {}
      )
    ).toBeNull();
  });
});

it.each(["/outside", "..", "../outside", "apps\\web", "apps\0web"])(
  "rejects an unsafe root even with a directly pinned command: %s",
  async (rootDirectory) => {
    expect(
      await resolvePackageDevPort(repository("next dev"), {
        rootDirectory,
        devCommand: "next dev --port 3015",
      })
    ).toBeNull();
  }
);

it.each([
  ["next dev --port 65535", 65535],
  ["next dev --port 0", null],
  ["next dev --port x3015", null],
  ["next dev --port 3015x", null],
  ["next dev --port '3015", null],
  ["env PORT=5010 NODE_ENV=development next dev", 5010],
  ["npm run-script serve", 4123],
  ["pnpm --dir apps/web --cwd apps/admin dev", null],
  ["pnpm --filter @acme/web --dir apps/admin dev", null],
])("handles command boundaries: %s", async (command, port) => {
  expect(await resolvePackageDevPort(repository(command as string), {})).toBe(
    port
  );
});

it("follows explicit workspace paths and package.json workspace objects", async () => {
  expect(
    await resolvePackageDevPort(
      repository("", undefined, {
        "package.json": JSON.stringify({
          workspaces: { packages: ["apps/web"] },
          scripts: { dev: "npm --workspace @acme/web run dev" },
        }),
      }),
      {}
    )
  ).toBe(3015);
});

it("does not guess a workspace from an unsupported recursive glob", async () => {
  expect(
    await resolvePackageDevPort(
      repository("", undefined, {
        "package.json": JSON.stringify({
          workspaces: ["apps/**"],
          scripts: { dev: "pnpm --filter @acme/web dev" },
        }),
      }),
      {}
    )
  ).toBeNull();
});

it.each([
  "pnpm exec next dev",
  "npm exec -- next dev",
  "yarn exec next dev",
  "bun exec next dev",
  "pnpm dlx next dev",
  "yarn dlx next dev",
  "bun x next dev",
])(
  "preserves static PORT through executable invocation: %s",
  async (executable) => {
    const command = `PORT=3015 ${executable}`;
    expect(await resolvePackageDevPort(repository(command), {})).toBe(3015);
    expect(
      await resolvePackageDevPort(repository("next dev"), {
        devCommand: command,
      })
    ).toBe(3015);
    expect(
      await resolvePackageDevPort(
        repository("pnpm run serve", undefined, {
          "package.json": JSON.stringify({
            scripts: { dev: "pnpm run serve", serve: command },
          }),
        }),
        {}
      )
    ).toBe(3015);
    expect(
      await resolvePackageDevPort(
        repository(`PORT=3015 pnpm run serve`, undefined, {
          "package.json": JSON.stringify({
            scripts: { dev: "PORT=3015 pnpm run serve", serve: executable },
          }),
        }),
        {}
      )
    ).toBe(3015);
    expect(
      await resolvePackageDevPort(repository(`${command} --port 4111`), {})
    ).toBe(4111);
  }
);

it("does not confuse an explicit script named exec with an executable invocation", async () => {
  const files = repository("PORT=3015 pnpm run exec", undefined, {
    "package.json": JSON.stringify({
      scripts: { dev: "PORT=3015 pnpm run exec", exec: "next dev --port 4111" },
    }),
  });
  expect(await resolvePackageDevPort(files, {})).toBe(4111);
});

it("reads only the selected manifest for an exact workspace directory", async () => {
  const files = repository("npm -w apps/web run dev");
  const reads: string[] = [];
  const port = await resolvePackageDevPort(
    {
      ...files,
      readText: async (path) => {
        reads.push(path);
        if (path === "apps/admin/package.json")
          throw new Error("Unrelated workspace must not be fetched");
        return files.readText(path);
      },
    },
    {}
  );
  expect(port).toBe(3015);
  expect(reads).toContain("apps/web/package.json");
  expect(reads).not.toContain("apps/admin/package.json");
});

it("bounds concurrent manifest reads for a package-name selector", async () => {
  const extra = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `apps/package-${index}/package.json`,
      JSON.stringify({
        name: `@acme/package-${index}`,
        scripts: { dev: "next dev -p 4099" },
      }),
    ])
  );
  const files = repository(
    "pnpm --filter @acme/package-19 dev",
    undefined,
    extra
  );
  let active = 0;
  let peak = 0;
  const port = await resolvePackageDevPort(
    {
      ...files,
      readText: async (path) => {
        if (!path.startsWith("apps/")) return files.readText(path);
        active += 1;
        peak = Math.max(peak, active);
        try {
          await Promise.resolve();
          return await files.readText(path);
        } finally {
          active -= 1;
        }
      },
    },
    {}
  );
  expect(port).toBe(4099);
  expect(peak).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(4);
});

it.each([
  ["npm run serve --port 4222", null],
  ["npm run serve -- --port 4222", 4222],
  ["npm run serve -p 4222", null],
  ["npm run serve -- -p 4222", 4222],
])(
  "distinguishes npm options from forwarded flags: %s",
  async (command, port) => {
    for (const dev of [command, "npm run start"]) {
      const files = repository("", undefined, {
        "package.json": JSON.stringify({
          scripts: { dev, start: command, serve: "next dev" },
        }),
      });
      expect(await resolvePackageDevPort(files, {})).toBe(port);
    }
  }
);

it("retains a script's own pin when npm consumes an option", async () => {
  expect(
    await resolvePackageDevPort(repository("npm run serve --port 4222"), {})
  ).toBe(4123);
});

it("interprets forwarded flags again when an alias launches another npm command", async () => {
  expect(
    await resolvePackageDevPort(
      repository("", undefined, {
        "package.json": JSON.stringify({
          scripts: {
            dev: "npm run start -- --port 4222",
            start: "npm run serve",
            serve: "next dev",
          },
        }),
      }),
      {}
    )
  ).toBeNull();
});

it("preserves environment precedence inside executed commands", async () => {
  expect(
    await resolvePackageDevPort(
      repository("PORT=3015 pnpm exec env PORT=4111 next dev"),
      {}
    )
  ).toBe(4111);
});

it.each([
  ["PORT=3015 npm exec next dev --port 4222", 3015],
  ["PORT=3015 npm exec -- next dev --port 4222", 4222],
])(
  "keeps npm exec options separate from server flags: %s",
  async (command, port) => {
    expect(await resolvePackageDevPort(repository(command as string), {})).toBe(
      port
    );
  }
);

it("preserves pnpm's forwarded end-of-options delimiter", async () => {
  const files = repository("pnpm run serve -- --port 4201", undefined, {
    "package.json": JSON.stringify({
      scripts: {
        dev: "pnpm run serve -- --port 4201",
        serve: "vite --port 3015",
      },
    }),
  });
  expect(await resolvePackageDevPort(files, {})).toBe(3015);
});

it("stops executable port extraction at the end-of-options delimiter", async () => {
  expect(
    await resolvePackageDevPort(
      repository("vite --port 3015 -- --port 4201"),
      {}
    )
  ).toBe(3015);
  expect(
    await resolvePackageDevPort(
      repository("PORT=3015 npm run serve -- -- --port 4201", undefined, {
        "package.json": JSON.stringify({
          scripts: {
            dev: "PORT=3015 npm run serve -- -- --port 4201",
            serve: "vite",
          },
        }),
      }),
      {}
    )
  ).toBe(3015);
});

it.each([
  ["PORT=3015 npm exec next dev -- --port 4222", 4222],
  ["PORT=3015 npm exec --package next next dev -- --port 4222", 4222],
  ["PORT=3015 cross-env PORT=4111 next dev", 4111],
  ["PORT=3015 env PORT=4111 next dev", 4111],
  ["env PORT=3015 cross-env PORT=4111 env NODE_ENV=development next dev", 4111],
  ["PORT=3015 cross-env PORT=4111 next dev --port 4222", 4222],
])(
  "preserves executable and environment prefixes: %s",
  async (command, port) => {
    expect(await resolvePackageDevPort(repository(command as string), {})).toBe(
      port
    );
    expect(
      await resolvePackageDevPort(
        repository("", undefined, {
          "package.json": JSON.stringify({
            scripts: { dev: "pnpm run serve", serve: command },
          }),
        }),
        {}
      )
    ).toBe(port);
  }
);
