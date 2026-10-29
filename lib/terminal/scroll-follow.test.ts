import { describe, expect, it } from "vitest";
import {
  createTerminalScrollFollow,
  type TerminalScrollMetrics,
} from "./scroll-follow";

const bottom: TerminalScrollMetrics = {
  scrollTop: 600,
  scrollHeight: 800,
  clientHeight: 200,
  rowHeight: 17,
};

describe("terminal scroll following", () => {
  it("keeps following when wterm rebuilds rows during resize", () => {
    const state = createTerminalScrollFollow(bottom);
    state.onScroll({ ...bottom, clientHeight: 180 }, true);
    state.onScroll(
      {
        ...bottom,
        scrollTop: 0,
        scrollHeight: 180,
        clientHeight: 180,
      },
      true
    );
    state.onScroll({ ...bottom, scrollTop: 0, clientHeight: 180 }, true);
    expect(state.following).toBe(true);
  });

  it("accepts wterm's whole-row bottom alignment", () => {
    const state = createTerminalScrollFollow(bottom);
    state.onScroll({ ...bottom, scrollTop: 588 });
    expect(state.following).toBe(true);
  });

  it("keeps a manual scroll position through empty and rebuilt rows", () => {
    const state = createTerminalScrollFollow(bottom);
    state.onScroll({ ...bottom, scrollTop: 0 });
    expect(state.following).toBe(false);
    state.onScroll(
      {
        ...bottom,
        scrollTop: 0,
        scrollHeight: 180,
        clientHeight: 180,
      },
      true
    );
    expect(state.following).toBe(false);
    state.onScroll({ ...bottom, scrollTop: 0, clientHeight: 180 }, true);
    expect(state.following).toBe(false);
    state.onScroll({ ...bottom, scrollTop: 620, clientHeight: 180 });
    expect(state.following).toBe(true);
  });

  it("resumes following when the reader returns to the bottom after reflow", () => {
    const state = createTerminalScrollFollow(bottom);
    state.onScroll({ ...bottom, scrollTop: 0 });
    state.onScroll({ ...bottom, scrollTop: 0, clientHeight: 180 }, true);
    expect(state.following).toBe(false);
    state.onScroll({ ...bottom, scrollTop: 605, clientHeight: 180 });
    expect(state.following).toBe(true);
  });
});
