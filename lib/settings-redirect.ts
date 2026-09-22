import type { ScopeContext } from "./scope-context";
import { scopedHref } from "./scoped-href";

const MOVED_PERSONAL_TABS = new Map([
  ["models", "/models/catalog"],
  ["agents", "/agents/roster"],
]);

/** Preserve provider return messages while retiring Settings deep links. */
export function getLegacySettingsDestination(
  scope: ScopeContext,
  query: string,
  hash = ""
): string | null {
  const params = new URLSearchParams(query);
  const tab = params.get("tab") || hash.replace(/^#/, "");
  const isConnectionReturn = params.has("oauth") || params.has("slack");
  const path =
    tab === "connections" || isConnectionReturn
      ? "/connections"
      : scope.kind === "personal"
        ? MOVED_PERSONAL_TABS.get(tab)
        : undefined;
  if (!path) return null;
  params.delete("tab");
  params.delete("sub");
  const remaining = params.toString();
  return scopedHref(scope.slug, remaining ? `${path}?${remaining}` : path);
}
