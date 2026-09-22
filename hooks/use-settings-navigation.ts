"use client";

import { useEffect, useRef, useState } from "react";
import { scopedHref } from "@/lib/scoped-href";

export function useSettingsNavigation(scope: string, pathname: string) {
  const [menu, setMenu] = useState({ pathname, dismissed: false });
  const settingsLinkRef = useRef<HTMLAnchorElement>(null);
  const settingsPath = scopedHref(scope, "/settings");
  const inSettings =
    pathname === settingsPath || pathname.startsWith(`${settingsPath}/`);

  // Back only changes the current menu. A new route starts fresh.
  if (menu.pathname !== pathname) {
    setMenu({ pathname, dismissed: false });
  }
  const dismissed = menu.pathname === pathname && menu.dismissed;

  useEffect(() => {
    if (dismissed) settingsLinkRef.current?.focus();
  }, [dismissed]);

  return {
    showSettings: inSettings && !dismissed,
    settingsLinkRef,
    backToMain: () => setMenu({ pathname, dismissed: true }),
    openSettings: () => setMenu({ pathname, dismissed: false }),
  };
}
