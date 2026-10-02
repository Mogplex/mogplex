"use client";

import { useEffect, useRef } from "react";

/** A palette selection changes the URL without remounting Control. */
export function useControlDeepLink(
  target: string | null | undefined,
  selectSession: (id: string) => Promise<boolean>
) {
  const previous = useRef(target);
  useEffect(() => {
    const changed = previous.current !== target;
    previous.current = target;
    if (changed && target) void selectSession(target);
  }, [target, selectSession]);
}
