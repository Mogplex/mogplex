import { describe, expect, it, vi } from "vitest";
import {
  deleteVercelSandboxByName,
  findVercelSandboxByName,
} from "@/lib/sandbox/named-sandbox";

const credentials = {
  vercelToken: "vercel-token",
  vercelProjectId: "prj_1",
  vercelTeamId: "team_1",
};

describe("findVercelSandboxByName", () => {
  it("should return the exact-name match from a prefix-scoped listing", async () => {
    const listSandboxes = vi.fn(async () => [
      { name: "mogplex-u-r-main-root-extra", status: "running" },
      { name: "mogplex-u-r-main-root", status: "stopped", persistent: false },
    ]);

    const result = await findVercelSandboxByName(
      "mogplex-u-r-main-root",
      credentials,
      { listSandboxes: listSandboxes as never }
    );

    expect(listSandboxes).toHaveBeenCalledWith(
      credentials,
      expect.objectContaining({
        sortBy: "name",
        namePrefix: "mogplex-u-r-main-root",
      })
    );
    expect(result).toEqual({
      name: "mogplex-u-r-main-root",
      status: "stopped",
      persistent: false,
    });
  });

  it("should return null when only longer names share the prefix", async () => {
    const result = await findVercelSandboxByName(
      "mogplex-u-r-main-root",
      credentials,
      {
        listSandboxes: (async () => [
          { name: "mogplex-u-r-main-root-2" },
        ]) as never,
      }
    );

    expect(result).toBeNull();
  });
});

describe("deleteVercelSandboxByName", () => {
  it("should issue a DELETE scoped to the project and team", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await deleteVercelSandboxByName("mogplex-u-r-main-root", credentials, {
      fetchImpl: fetchImpl as never,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe(
      "https://api.vercel.com/v2/sandboxes/mogplex-u-r-main-root?projectId=prj_1&teamId=team_1"
    );
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ Authorization: "Bearer vercel-token" });
  });

  it("should treat 404 as already deleted", async () => {
    await expect(
      deleteVercelSandboxByName("gone", credentials, {
        fetchImpl: (async () =>
          new Response('{"error":{"code":"not_found"}}', {
            status: 404,
          })) as never,
      })
    ).resolves.toBeUndefined();
  });

  it("should throw with the status for other failures", async () => {
    await expect(
      deleteVercelSandboxByName("locked", credentials, {
        fetchImpl: (async () =>
          new Response("forbidden", { status: 403 })) as never,
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
