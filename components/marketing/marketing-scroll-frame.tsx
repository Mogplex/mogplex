"use client";

import { type ReactNode, useEffect, useRef } from "react";

export function MarketingScrollFrame({ children, className }: { children: ReactNode; className: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      rootRef.current?.classList.add("is-scrolling");
      clearTimeout(timer);
      timer = setTimeout(() => rootRef.current?.classList.remove("is-scrolling"), 180);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(timer); };
  }, []);
  return <div className={className} ref={rootRef}>{children}</div>;
}
