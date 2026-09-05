import { Sandbox } from "@vercel/sandbox";
import { afterEach, expect, it, vi } from "vitest";
import {
  createSandboxForRepo,
  createSandboxFromSnapshot,
} from "./client-lifecycle";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const credentials = { vercelToken: "fixture", vercelProjectId: "project" };
const sources = [
  {
    name: "git",
    create: () =>
      createSandboxForRepo({
        ...credentials,
        githubToken: "fixture",
        repoFullName: "acme/repo",
      }),
  },
  {
    name: "snapshot",
    create: () =>
      createSandboxFromSnapshot({ ...credentials, snapshotId: "snap_fixture" }),
  },
];

it.each(sources)(
  "$name creation cannot silently replace required persistence with an ephemeral VM",
  async ({ create }) => {
    vi.stubEnv("ENABLE_PERSISTENT_SANDBOXES", "true");
    vi.stubEnv("DISABLE_PERSISTENT_SANDBOXES", "false");
    const denied = Object.assign(
      new Error("Persistent sandboxes not enabled"),
      { status: 403 }
    );
    // The old fallback would succeed with this lossy VM after the first error.
    const ephemeral = { persistent: false } as Awaited<
      ReturnType<typeof Sandbox.create>
    >;
    const provider = vi
      .spyOn(Sandbox, "create")
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce(ephemeral);
    await expect(create()).rejects.toBe(denied);
    expect(provider).toHaveBeenCalledTimes(1);
  }
);

it.each(sources)(
  "$name creation preserves an explicit operator disable",
  async ({ create }) => {
    vi.stubEnv("ENABLE_PERSISTENT_SANDBOXES", "true");
    vi.stubEnv("DISABLE_PERSISTENT_SANDBOXES", "true");
    const sandbox = { persistent: false } as Awaited<
      ReturnType<typeof Sandbox.create>
    >;
    const provider = vi.spyOn(Sandbox, "create").mockResolvedValueOnce(sandbox);
    expect(await create()).toBe(sandbox);
    expect(provider.mock.calls[0][0]).toMatchObject({ persistent: false });
  }
);

it.each(sources)(
  "$name creation requests the existing retention when enabled",
  async ({ create }) => {
    vi.stubEnv("ENABLE_PERSISTENT_SANDBOXES", "true");
    vi.stubEnv("DISABLE_PERSISTENT_SANDBOXES", "false");
    const sandbox = { persistent: true } as Awaited<
      ReturnType<typeof Sandbox.create>
    >;
    const provider = vi.spyOn(Sandbox, "create").mockResolvedValueOnce(sandbox);
    expect(await create()).toBe(sandbox);
    expect(provider.mock.calls[0][0]).toMatchObject({
      persistent: true,
      snapshotExpiration: 7 * 24 * 60 * 60 * 1000,
    });
  }
);
