"use client";

import { useCallback, useEffect } from "react";
import { useTheme } from "next-themes";
import { toast } from "@/hooks/use-toast";
import {
  applyThemePreference,
  isThemePreference,
  readStoredThemePreference,
  type ThemePreference,
} from "@/lib/theme-preferences";

// Module-scoped ordering state: the consumer (ThemeSwitcher) lives inside the
// user dropdown's DropdownMenuContent, which is remounted every time the menu
// closes and reopens. Keeping these as component refs would reset the
// stale-response guards between saves; module scope preserves them for the
// lifetime of the page.
//
// Single-instance contract: this hook assumes at most ONE active consumer per
// page (currently just the user-menu ThemeSwitcher). If a second mount appears
// (e.g., a settings-page theme picker), the two consumers would race on the
// counters and a save in one could cancel the other's rollback guard. The
// dev-mode invariant below will surface that case loudly so we can refactor
// to a context-provider singleton before it ships. SSR is not a concern
// because this file is "use client". HMR/fast-refresh preserves module state
// across re-renders, which is fine — the seq numbers just keep counting up.
let latestTheme: ThemePreference | null = null;
let confirmedTheme: ThemePreference | null = null;
let themeSaveRequestSeq = 0;
let confirmedThemeRequestSeq = 0;
let activeMountCount = 0;

type UseThemeSelectorResult = {
  theme: string | undefined;
  selectTheme: (next: ThemePreference) => void;
};

export function useThemeSelector(): UseThemeSelectorResult {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      activeMountCount += 1;
      if (activeMountCount > 1) {
        console.warn(
          "[useThemeSelector] More than one consumer is mounted concurrently. " +
            "The module-scoped ordering guards assume a single active consumer; " +
            "refactor to a context-provider singleton before relying on this."
        );
      }
      return () => {
        activeMountCount -= 1;
      };
    }
  }, []);

  useEffect(() => {
    if (isThemePreference(theme)) {
      latestTheme = theme;
    }
  }, [theme]);

  const readCurrentThemePreference = useCallback(
    () => latestTheme ?? readStoredThemePreference(),
    []
  );

  const selectTheme = useCallback(
    (nextTheme: ThemePreference) => {
      const rollbackBaseline = confirmedTheme ?? readCurrentThemePreference();
      if (rollbackBaseline && !confirmedTheme) {
        confirmedTheme = rollbackBaseline;
      }
      const requestId = themeSaveRequestSeq + 1;
      themeSaveRequestSeq = requestId;
      latestTheme = nextTheme;

      applyThemePreference(nextTheme);
      setTheme(nextTheme);

      const rollbackThemeSelection = () => {
        if (themeSaveRequestSeq !== requestId) return;
        const rollbackTheme = confirmedTheme ?? rollbackBaseline;
        if (!rollbackTheme) {
          toast({
            title: "Theme preference not saved",
            description: "Refresh to reload your saved theme.",
            variant: "destructive",
          });
          return;
        }

        latestTheme = rollbackTheme;
        applyThemePreference(rollbackTheme);
        setTheme(rollbackTheme);
        toast({
          title: "Theme preference not saved",
          description: "Restored your previous theme.",
          variant: "destructive",
        });
      };

      const persistThemePreference = async () => {
        let saveSucceeded = false;

        try {
          const response = await fetch("/api/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme: nextTheme }),
          });
          saveSucceeded = response.ok;
        } catch {
          // Network errors use the same rollback path as non-2xx saves.
        }

        if (saveSucceeded) {
          if (requestId > confirmedThemeRequestSeq) {
            confirmedTheme = nextTheme;
            confirmedThemeRequestSeq = requestId;
          }
          return;
        }

        try {
          rollbackThemeSelection();
        } catch (error) {
          console.error("[useThemeSelector] rollback failed", error);
          toast({
            title: "Theme preference not saved",
            description: "Refresh to reload your saved theme.",
            variant: "destructive",
          });
        }
      };

      void persistThemePreference().catch((error) => {
        console.error(
          "[useThemeSelector] persistThemePreference unhandled rejection",
          error
        );
        toast({
          title: "Theme preference not saved",
          description: "Refresh to reload your saved theme.",
          variant: "destructive",
        });
      });
    },
    [readCurrentThemePreference, setTheme]
  );

  return { theme, selectTheme };
}
