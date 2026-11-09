import { describe, expect, it, vi } from "vitest";
import {
  pruneUnconnectedRepos,
  type PruneUnconnectedReposDeps,
} from "./github-repo-prune";

function deps(
  result: Awaited<ReturnType<PruneUnconnectedReposDeps["rpc"]>> | Error
) {
  return {
    rpc: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    logger: { error: vi.fn(), info: vi.fn() },
  };
}

describe("pruneUnconnectedRepos", () => {
  it("should call the prune function for the user after an App sync that returned repositories", async () => {
    const injected = deps({ data: 3, error: null });

    const deleted = await pruneUnconnectedRepos("user-1", 5, injected);

    expect(deleted).toBe(3);
    expect(injected.rpc).toHaveBeenCalledWith("prune_unconnected_repos", {
      p_user_id: "user-1",
    });
    expect(injected.logger.info).toHaveBeenCalledWith(
      "Pruned unconnected repositories",
      { userId: "user-1", deleted: 3 }
    );
  });

  it("should not touch the database when the App sync returned no repositories", async () => {
    const injected = deps({ data: 3, error: null });

    expect(await pruneUnconnectedRepos("user-1", 0, injected)).toBe(0);
    expect(injected.rpc).not.toHaveBeenCalled();
  });

  it("should fail open and log when the database reports an error", async () => {
    const injected = deps({ data: null, error: { message: "boom" } });

    expect(await pruneUnconnectedRepos("user-1", 2, injected)).toBe(0);
    expect(injected.logger.error).toHaveBeenCalledWith(
      "Failed to prune unconnected repositories",
      { userId: "user-1", error: "boom" }
    );
  });

  it("should fail open when the call itself throws", async () => {
    const injected = deps(new Error("network"));

    expect(await pruneUnconnectedRepos("user-1", 2, injected)).toBe(0);
    expect(injected.logger.error).toHaveBeenCalledOnce();
  });

  it("should stay quiet when nothing was deleted", async () => {
    const injected = deps({ data: 0, error: null });

    expect(await pruneUnconnectedRepos("user-1", 2, injected)).toBe(0);
    expect(injected.logger.info).not.toHaveBeenCalled();
  });
});
