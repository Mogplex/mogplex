import { scopedHref } from "./scoped-href";

export const PERSONAL_SETTINGS = [
  { id: "account", label: "Account" },
  { id: "teams", label: "Teams" },
  { id: "keys", label: "Provider Keys" },
  { id: "mogplex-keys", label: "Mogplex Keys" },
  { id: "billing", label: "Billing" },
] as const;

export const TEAM_SETTINGS = [
  { id: "members", label: "Members" },
  { id: "keys", label: "Provider Keys" },
  { id: "models", label: "Models" },
  { id: "audit", label: "Audit" },
  { id: "billing", label: "Billing" },
] as const;

export type SettingsSection =
  | (typeof PERSONAL_SETTINGS)[number]["id"]
  | (typeof TEAM_SETTINGS)[number]["id"];

export function buildSettingsNavItems(
  slug: string,
  kind: "personal" | "team",
  canManageTeam = false
) {
  return (kind === "team" ? TEAM_SETTINGS : PERSONAL_SETTINGS)
    .filter((item) => item.id !== "audit" || canManageTeam)
    .map((item) => ({
      ...item,
      href: scopedHref(slug, `/settings/${item.id}`),
    }));
}
