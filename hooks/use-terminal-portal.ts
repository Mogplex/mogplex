"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createFallbackContainer } from "@/lib/terminal/helpers";
import { resolveTerminalPortalTarget } from "@/lib/terminal-portal-target";

type PortalBinding = {
  paneId: string;
  terminalSessionKey: string;
  sandboxId: string | null | undefined;
  repoId: string | null | undefined;
  workingBranch: string | null | undefined;
};

/**
 * Manages portal target resolution and anchor tracking for terminal sessions.
 * When XTermPane remounts (e.g. root-pane split restructures the tree), anchor
 * briefly becomes null before the new div registers. Using the last non-null
 * anchor avoids an unnecessary fallback handoff while React replaces the div.
 */
export function useTerminalPortal(
  anchor: HTMLElement | null,
  binding: PortalBinding
) {
  const { paneId, terminalSessionKey, sandboxId, repoId, workingBranch } =
    binding;

  const [fallbackContainer, setFallbackContainer] =
    useState<HTMLDivElement | null>(null);
  const portalHostRef = useRef<HTMLDivElement | null>(null);

  const lastAnchorRef = useRef<HTMLElement | null>(null);
  const lastAnchorSizeRef = useRef<{ width: number; height: number } | null>(
    null
  );
  const hasConnectedAnchorRef = useRef(false);
  const lastPortalBindingKeyRef = useRef<string | null>(null);

  // Create portal host element once
  if (!portalHostRef.current && typeof document !== "undefined") {
    const host = document.createElement("div");
    host.setAttribute("data-terminal-session-host", paneId);
    host.style.cssText = "height:100%;width:100%;";
    portalHostRef.current = host;
  }

  // Track binding changes and anchor connection
  const portalBindingKey = `${paneId}:${terminalSessionKey}:${sandboxId ?? ""}:${repoId ?? ""}:${workingBranch ?? ""}`;
  if (lastPortalBindingKeyRef.current !== portalBindingKey) {
    lastPortalBindingKeyRef.current = portalBindingKey;
    lastAnchorRef.current = anchor?.isConnected ? anchor : null;
    hasConnectedAnchorRef.current = Boolean(anchor?.isConnected);
  }
  if (anchor?.isConnected) {
    lastAnchorRef.current = anchor;
    hasConnectedAnchorRef.current = true;
  }

  // Create fallback container on mount
  useLayoutEffect(() => {
    const fallback = createFallbackContainer(paneId);
    document.body.append(fallback);
    setFallbackContainer(fallback);
    return () => fallback.remove();
  }, [paneId]);

  // Track anchor size for fallback container
  useLayoutEffect(() => {
    if (!anchor?.isConnected) return;
    const rememberAnchorSize = () => {
      if (!anchor.isConnected) return;
      const width = anchor.clientWidth;
      const height = anchor.clientHeight;
      if (width > 0 && height > 0) {
        lastAnchorSizeRef.current = { width, height };
        if (fallbackContainer) {
          fallbackContainer.style.width = `${width}px`;
          fallbackContainer.style.height = `${height}px`;
        }
      }
    };
    rememberAnchorSize();
    const observer = new ResizeObserver(rememberAnchorSize);
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchor, fallbackContainer]);

  // Resolve portal target
  const portalTarget = useMemo(() => {
    if (!hasConnectedAnchorRef.current && !anchor?.isConnected) {
      return null;
    }
    return resolveTerminalPortalTarget({
      anchor,
      lastAnchor: lastAnchorRef.current,
      fallback: fallbackContainer,
    });
  }, [anchor, fallbackContainer]);

  // Attach portal host to target
  useLayoutEffect(() => {
    const host = portalHostRef.current;
    if (!host || !portalTarget) return;
    if (host.parentElement === portalTarget) return;
    portalTarget.append(host);
  }, [portalTarget]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      lastAnchorRef.current = null;
      lastAnchorSizeRef.current = null;
      hasConnectedAnchorRef.current = false;
      lastPortalBindingKeyRef.current = null;
      portalHostRef.current?.remove();
    },
    [paneId]
  );

  return {
    portalTarget,
    portalHost: portalHostRef.current,
    fallbackContainer,
    lastAnchorSizeRef,
  };
}
