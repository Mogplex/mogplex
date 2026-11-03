"use client";

import { useLayoutEffect, useState } from "react";
import { autoUpdate } from "@floating-ui/dom";

type Bounds = { top: number; maxHeight: number; compact: boolean };

/** Follow the real conversation controls rather than guessing their height. */
export function useToastViewport(active: boolean) {
  const [bounds, setBounds] = useState<Bounds>();

  useLayoutEffect(() => {
    if (!active) {
      setBounds(undefined);
      return;
    }
    let composer: HTMLElement | null = null;
    let toolbar: HTMLElement | null = null;
    let controls: HTMLElement | null = null;
    let cleanupPosition: (() => void) | undefined;
    const measure = () => {
      if (!composer || !toolbar) {
        setBounds(undefined);
        return;
      }
      const inputTop = composer.getBoundingClientRect().top;
      const toolbarBox = toolbar.getBoundingClientRect();
      const defaultTop =
        11 *
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const regularTop = Math.max(defaultTop, toolbarBox.bottom + 12);
      const compact = inputTop - regularTop < 96;
      const targets = [...toolbar.querySelectorAll("button")]
        .map((button) => button.getBoundingClientRect())
        .filter((box) => box.width && box.height);
      const top = compact
        ? Math.max(0, ...targets.map((box) => box.bottom), toolbarBox.top) + 2
        : regularTop;
      const available = Math.max(0, inputTop - top);
      const gap = compact ? Math.max(0, Math.min(2, available - 44)) : 12;
      const maxHeight = Math.max(
        0,
        Math.min(window.innerHeight / 2, available - gap)
      );
      setBounds((current) =>
        current?.top === top &&
        current.maxHeight === maxHeight &&
        current.compact === compact
          ? current
          : { top, maxHeight, compact }
      );
    };
    const bind = () => {
      const nextComposer =
        document.querySelector<HTMLElement>("#control-composer");
      const nextToolbar = document.querySelector<HTMLElement>(
        ".task-workspace-toolbar"
      );
      if (nextComposer === composer && nextToolbar === toolbar) return;
      cleanupPosition?.();
      cleanupPosition = undefined;
      composer = nextComposer;
      controls = composer?.closest("fieldset") ?? null;
      toolbar = nextToolbar;
      if (composer && toolbar)
        cleanupPosition = autoUpdate(composer, toolbar, measure, {
          animationFrame: false,
        });
      else measure();
    };
    const mutations = new MutationObserver((records) => {
      bind();
      if (
        records.some(
          ({ target }) =>
            controls?.contains(target) || toolbar?.contains(target)
        )
      )
        measure();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    bind();
    return () => {
      mutations.disconnect();
      cleanupPosition?.();
    };
  }, [active]);

  return bounds;
}
