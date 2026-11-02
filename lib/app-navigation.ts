import { scopedHref } from "@/lib/scoped-href";

export const APP_NAV_ITEM_DEFS = [
  {
    id: "control",
    label: "Command Center",
    path: "/control",
    // Command Center is the only place to work on repos; the repo workspace
    // view is part of it.
    subpaths: ["/control", "/projects/workspace", "/workspaces"],
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
    path: "/sandboxes",
    subpaths: ["/sandboxes"],
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
    id: "agents",
    label: "Agents",
    path: "/agents/roster",
    subpaths: ["/agents"],
    section: "primary",
  },
  {
    id: "models",
    label: "Models",
    path: "/models",
    subpaths: ["/models"],
    section: "primary",
  },
  {
    id: "connections",
    label: "Connections",
    path: "/connections",
    subpaths: ["/connections"],
    section: "primary",
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    subpaths: ["/settings"],
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
  return matches.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
