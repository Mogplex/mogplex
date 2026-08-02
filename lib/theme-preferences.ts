export const THEME_COOKIE_NAME = "mogplex-theme";
// Must match the storageKey passed to ThemeProvider for next-themes.
export const THEME_STORAGE_KEY = "theme";

export const THEME_OPTIONS = ["dark", "light", "system"] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number];

type ThemePreferenceGlobal = typeof globalThis & {
  __mogplexThemePreferenceMutationVersion?: number;
};

function getThemePreferenceGlobal() {
  return globalThis as ThemePreferenceGlobal;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    THEME_OPTIONS.includes(value as ThemePreference)
  );
}

export function readStoredThemePreference() {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedTheme) ? storedTheme : null;
  } catch {
    return null;
  }
}

export function getThemePreferenceMutationVersion() {
  return (
    getThemePreferenceGlobal().__mogplexThemePreferenceMutationVersion ?? 0
  );
}

export function applyThemePreference(preference: ThemePreference) {
  const themePreferenceGlobal = getThemePreferenceGlobal();
  // ThemeSettingsSync discards in-flight settings reads after any local theme mutation.
  themePreferenceGlobal.__mogplexThemePreferenceMutationVersion =
    (themePreferenceGlobal.__mogplexThemePreferenceMutationVersion ?? 0) + 1;
  const resolvedTheme =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;

  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(resolvedTheme);

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage failures in constrained environments.
  }

  return resolvedTheme;
}
