"use client";

import { useCallback, useRef } from "react";
import { ANSI } from "@/lib/terminal/styles";

type BannerCallbacks = {
  write: (data: string) => void;
  writeln: (data: string) => void;
  writePrompt: () => void;
};

type BannerRefs = {
  ptyConnectedRef: React.RefObject<boolean>;
};

/**
 * Manages terminal banner rendering and updates.
 */
export function useTerminalBanner(
  execFallbackMessage: string | null,
  refs: BannerRefs,
  callbacks: BannerCallbacks
) {
  const { ptyConnectedRef } = refs;
  const { write, writeln, writePrompt } = callbacks;

  const bannerShownRef = useRef(false);
  const paintedBannerMessageRef = useRef<string | null>(null);
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderBanner = useCallback(
    (message: string | null) => {
      paintedBannerMessageRef.current = message;
      write(ANSI.CLEAR_SCREEN);
      writeln(`${ANSI.WHITE}Mogplex${ANSI.RESET} Terminal Ready`);
      if (message) {
        writeln(`${ANSI.GRAY}${message}${ANSI.RESET}`);
      }
      writePrompt();
    },
    [write, writeln, writePrompt]
  );

  const appendBannerMessage = useCallback(
    (message: string) => {
      paintedBannerMessageRef.current = message;
      write("\r\n");
      writeln(`${ANSI.GRAY}${message}${ANSI.RESET}`);
      writePrompt();
    },
    [write, writeln, writePrompt]
  );

  const paintBanner = useCallback(() => {
    if (bannerShownRef.current || ptyConnectedRef.current) return;
    bannerShownRef.current = true;
    if (resizeDebounceRef.current) {
      clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = null;
    }
    if (readyFallbackRef.current) {
      clearTimeout(readyFallbackRef.current);
      readyFallbackRef.current = null;
    }
    renderBanner(execFallbackMessage);
  }, [execFallbackMessage, ptyConnectedRef, renderBanner]);

  return {
    bannerShownRef,
    paintedBannerMessageRef,
    resizeDebounceRef,
    readyFallbackRef,
    renderBanner,
    appendBannerMessage,
    paintBanner,
  };
}
