import { scopedHref } from "@/lib/scoped-href";

export const APP_NAV_ITEM_DEFS = [
  {
    id: "control",
    label: "Command Center",
    path: "/control",
    subpaths: ["/control"],
    section: "primary",
  },
  {
    id: "workspaces",
    label: "Repositories",
    path: "/projects/repositories",
    subpaths: ["/projects/repositories", "/projects/workspace", "/workspaces"],
    section: "primary",
  },
  {
    id: "automations",
    label: "Automations",
    path: "/automations",
    subpaths: ["/automations", "/workflows", "/flows", "/triggers"],
    section: "primary",
  },
  {
    id: "sandboxes",
    label: "Sandboxes",
    path: "/projects/repositories/sandboxes",
    subpaths: ["/projects/repositories/sandboxes"],
    section: "primary",
  },
  {
    id: "delivery",
    label: "Delivery",
    path: "/delivery",
    subpaths: ["/delivery"],
    section: "primary",
  },
  {
    id: "observe",
    label: "Observe",
    path: "/observability",
    subpaths: ["/observability", "/observe", "/runs"],
    section: "primary",
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    subpaths: ["/settings", "/agents"],
    section: "admin",
  },
] as const;

export type AppNavSection = (typeof APP_NAV_ITEM_DEFS)[number]["section"];

export type AppNavItemId = (typeof APP_NAV_ITEM_DEFS)[number]["id"];

export type AppNavItem = ReturnType<typeof buildAppNavItems>[number];

export function buildAppNavItems(scope: string) {
  return APP_NAV_ITEM_DEFS.map((item) => ({
    ...item,
    href: scopedHref(scope, item.path),
    match: item.subpaths.map((subpath) => scopedHref(scope, subpath)),
  }));
}

export function isAppNavItemActive(pathname: string, match: string | string[]) {
  const matches = Array.isArray(match) ? match : [match];
  return matches.some((m) => {
    // Sandboxes owns the only current repositories child route in primary nav.
    if (m.endsWith("/projects/repositories")) return pathname === m;
    return pathname === m || pathname.startsWith(`${m}/`);
  });
}
