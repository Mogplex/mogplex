import { scopedHref } from "@/lib/scoped-href";

export const APP_NAV_ITEM_DEFS = [
  {
    id: "projects",
    label: "Projects",
    path: "/projects/workspace",
    subpath: "/projects",
  },
  {
    id: "agents",
    label: "Agents",
    path: "/agents/roster",
    subpath: "/agents",
  },
  {
    id: "workflows",
    label: "Workflows",
    path: "/workflows",
    subpath: "/workflows",
  },
  {
    id: "observability",
    label: "Observability",
    path: "/observability",
    subpath: "/observability",
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    subpath: "/settings",
  },
] as const;

export type AppNavItemId = (typeof APP_NAV_ITEM_DEFS)[number]["id"];

export function buildAppNavItems(scope: string) {
  return APP_NAV_ITEM_DEFS.map((item) => ({
    ...item,
    href: scopedHref(scope, item.path),
    match: scopedHref(scope, item.subpath),
  }));
}

export function isAppNavItemActive(pathname: string, match: string) {
  return pathname === match || pathname.startsWith(`${match}/`);
}
