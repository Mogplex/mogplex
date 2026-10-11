import { Sandbox } from "@vercel/sandbox";
import { afterEach, expect, it, vi } from "vitest";
import { listVercelSandboxes } from "./client-lifecycle";

afterEach(() => vi.restoreAllMocks());

it("includes retained workspaces beyond the provider's first page", async () => {
  const first = { name: "recent", status: "stopped" };
  const second = { name: "saved-work", status: "running" };
  const list = vi
    .spyOn(Sandbox, "list")
    .mockResolvedValueOnce({
      sandboxes: [first],
      pagination: { count: 1, next: "next-page" },
    } as never)
    .mockResolvedValueOnce({
      sandboxes: [second],
      pagination: { count: 1, next: null },
    } as never);
  expect(
    await listVercelSandboxes({
      vercelToken: "fixture",
      vercelProjectId: "project",
    })
  ).toEqual([first, second]);
  expect(list.mock.calls[1][0]).toMatchObject({
    cursor: "next-page",
    projectId: "project",
  });
});

it("keeps explicit lookup limits and filters bounded", async () => {
  const sandbox = { name: "target", status: "running" };
  const list = vi.spyOn(Sandbox, "list").mockResolvedValue({
    sandboxes: [sandbox],
    pagination: { count: 1, next: "more" },
  } as never);
  expect(
    await listVercelSandboxes(
      { vercelToken: "fixture", vercelProjectId: "project" },
      { limit: 1, namePrefix: "target" }
    )
  ).toEqual([sandbox]);
  expect(list).toHaveBeenCalledTimes(1);
});
