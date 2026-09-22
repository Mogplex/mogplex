import type { ScopeContext } from "./scope-context";
import { scopedHref } from "./scoped-href";
import { PERSONAL_SETTINGS, TEAM_SETTINGS } from "./settings-navigation";

const MOVED_PERSONAL_TABS = new Map([
  ["models", "/models/catalog"],
  ["agents", "/agents/roster"],
]);

/** Preserve provider return messages while retiring Settings deep links. */
export function getLegacySettingsDestination(
  scope: ScopeContext,
  query: string,
  hash = ""
): string {
  const params = new URLSearchParams(query);
  const tab = params.get("tab") || hash.replace(/^#/, "");
  const isConnectionReturn = params.has("oauth") || params.has("slack");
  const sections = scope.kind === "team" ? TEAM_SETTINGS : PERSONAL_SETTINGS;
  const section = sections.find((item) => item.id === tab)?.id;
  let path = `/settings/${section ?? (scope.kind === "team" ? "members" : "account")}`;
  if (tab === "connections" || tab === "mcp" || isConnectionReturn) {
    path = "/connections";
  } else if (scope.kind === "personal" && MOVED_PERSONAL_TABS.has(tab)) {
    path = MOVED_PERSONAL_TABS.get(tab)!;
  } else if (
    scope.kind === "personal" &&
    tab === "keys" &&
    params.get("sub") === "cli"
  ) {
    path = "/settings/mogplex-keys";
  } else if (!tab && params.has("billing")) {
    path = "/settings/billing";
  }
  params.delete("tab");
  params.delete("sub");
  if (tab === "mcp" && !isConnectionReturn) params.set("tab", "mcp");
  const remaining = params.toString();
  return scopedHref(scope.slug, remaining ? `${path}?${remaining}` : path);
}
