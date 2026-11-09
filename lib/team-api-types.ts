import type { TeamAuditPayload } from "@/lib/team-audit";
import type { TeamRole } from "@/lib/team-capabilities";

export type TeamMembersResponse = {
  team: { id: string; name: string; slug: string; iconUrl: string | null };
  viewer: { role: TeamRole; canManage: boolean };
  members: Array<{
    userId: string;
    name: string | null;
    username: string | null;
    email: string | null;
    avatarUrl: string | null;
    role: TeamRole;
    joinedAt: string;
    isCurrentUser: boolean;
  }>;
  invites: Array<{
    id: string;
    email: string;
    role: "admin" | "developer" | "viewer";
    expiresAt: string;
    createdAt: string;
  }>;
};

export type TeamModelsResponse = {
  modelAllowlist: string[] | null;
  viewer: { canManage: boolean };
};

export type TeamAuditEvent = {
  id: string;
  action: string;
  decisionCode: string | null;
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  repoId: string | null;
  sandboxRecordId: string | null;
  aiCallId: string | null;
  jobRunId: string | null;
  requestId: string | null;
  authSource: string | null;
  payload: TeamAuditPayload;
  createdAt: string;
};

export type TeamAuditEventsResponse = {
  events: TeamAuditEvent[];
  nextCursor: string | null;
  viewer: { canManage: boolean };
};
