import { describe, expect, it } from "vitest";
import { createToolBuildCache } from "./mogplex-tool-cache";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function counter() {
  const state = { builds: 0, cleanups: 0 };
  const build = async () => {
    state.builds += 1;
    return {
      tools: {},
      cleanup: async () => {
        state.cleanups += 1;
      },
    };
  };
  return { state, build };
}

describe("createToolBuildCache", () => {
  it("should reuse one build for a run's requests within the window", async () => {
    let time = 0;
    const cache = createToolBuildCache(60_000, () => time);
    const { state, build } = counter();

    const first = await cache.acquire("call-1", build);
    first.release();
    time = 30_000;
    const second = await cache.acquire("call-1", build);
    second.release();

    expect(state.builds).toBe(1);
    expect(state.cleanups).toBe(0);
  });

  it("should rebuild after the window and close the old build once no call holds it", async () => {
    let time = 0;
    const cache = createToolBuildCache(60_000, () => time);
    const { state, build } = counter();

    const held = await cache.acquire("call-1", build);
    time = 61_000;
    const fresh = await cache.acquire("call-1", build);
    expect(state.builds).toBe(2);
    expect(state.cleanups).toBe(0);

    held.release();
    await tick();
    expect(state.cleanups).toBe(1);
    fresh.release();
  });

  it("should close an idle expired build on the next request for any run", async () => {
    let time = 0;
    const cache = createToolBuildCache(60_000, () => time);
    const { state, build } = counter();

    (await cache.acquire("call-1", build)).release();
    time = 61_000;
    (await cache.acquire("call-2", build)).release();
    await tick();

    expect(state.cleanups).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it("should not reuse a failed build", async () => {
    const cache = createToolBuildCache(60_000, () => 0);
    let attempts = 0;
    const flaky = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("vault timeout");
      return { tools: {}, cleanup: async () => undefined };
    };

    await expect(cache.acquire("call-1", flaky)).rejects.toThrow(
      "vault timeout"
    );
    (await cache.acquire("call-1", flaky)).release();

    expect(attempts).toBe(2);
  });
});
