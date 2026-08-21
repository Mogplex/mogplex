// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { setupTimelineAutoFollow } from "./timeline-auto-follow";

describe("Control timeline auto-follow", () => {
  it("follows initially, pauses when the user scrolls up, and resumes near the bottom", () => {
    const scroll = document.createElement("div");
    const content = document.createElement("div");
    const bottom = document.createElement("div");
    let scrollHeight = 1_000;
    const callbacks: {
      resize?: ResizeObserverCallback;
      intersection?: IntersectionObserverCallback;
    } = {};
    const disconnectResize = vi.fn();
    const disconnectIntersection = vi.fn();

    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => 200 },
    });

    const cleanup = setupTimelineAutoFollow(
      scroll,
      content,
      bottom,
      (callback) => {
        callbacks.resize = callback;
        return { observe: vi.fn(), disconnect: disconnectResize };
      },
      (callback) => {
        callbacks.intersection = callback;
        return { observe: vi.fn(), disconnect: disconnectIntersection };
      }
    );

    expect(scroll.scrollTop).toBe(1_000);

    scroll.scrollTop = 400;
    callbacks.intersection?.(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
    scrollHeight = 1_100;
    callbacks.resize?.([], {} as ResizeObserver);
    expect(scroll.scrollTop).toBe(400);

    scroll.scrollTop = 860;
    callbacks.intersection?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
    scrollHeight = 1_200;
    callbacks.resize?.([], {} as ResizeObserver);
    expect(scroll.scrollTop).toBe(1_200);

    cleanup();
    expect(disconnectResize).toHaveBeenCalledOnce();
    expect(disconnectIntersection).toHaveBeenCalledOnce();
  });
});
