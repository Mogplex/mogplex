import type { TeamRole } from "@/lib/team-capabilities";

const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  viewer: "Viewer",
};

export function formatTeamRole(role: TeamRole | string): string {
  return ROLE_LABELS[role as TeamRole] ?? role;
}
