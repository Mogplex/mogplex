"use client";

import type { RefObject } from "react";
import { formatDate, roleOptions } from "./team-settings-helpers";
import type { TeamMembersResponse } from "@/app/api/teams/[teamId]/members/route";
import type { TeamRole } from "@/lib/team-capabilities";

type MembersTabContentProps = {
  teamSlug: string;
  membersData: TeamMembersResponse | undefined;
  membersError: Error | undefined;
  canManageMembers: boolean;
  canManageIcon: boolean;
  busyKey: string | null;
  inviteEmail: string;
  setInviteEmail: (value: string) => void;
  inviteRole: "admin" | "developer" | "viewer";
  setInviteRole: (value: "admin" | "developer" | "viewer") => void;
  inviteMember: () => void;
  updateMemberRole: (userId: string, role: TeamRole) => void;
  removeMember: (userId: string) => void;
  mutateInvite: (inviteId: string, action: "resend" | "revoke") => void;
  nextOwnerUserId: string;
  setNextOwnerUserId: (value: string) => void;
  ownerTransferCandidates: Array<{
    userId: string;
    name: string | null;
    username: string | null;
    email: string | null;
  }>;
  transferOwnership: () => void;
  uploadTeamIcon: (file: File) => void;
  removeTeamIcon: () => void;
  iconInputRef: RefObject<HTMLInputElement | null>;
};

export function MembersTabContent({
  membersData,
  membersError,
  canManageMembers,
  busyKey,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviteMember,
  updateMemberRole,
  removeMember,
  mutateInvite,
  nextOwnerUserId,
  setNextOwnerUserId,
  ownerTransferCandidates,
  transferOwnership,
}: MembersTabContentProps) {
  return (
    <div className="space-y-4">
      <section className="border border-border/60 bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title">Members</div>
          <div className="ui-section-caption">Team roles control model, tool, and sandbox permissions.</div>
        </div>
        <div className="space-y-3 px-5 pb-5">
          {membersError && <div className="text-sm text-destructive">Unable to load members.</div>}
          {canManageMembers && (
            <div className="grid gap-2 border border-border bg-background/60 p-3 md:grid-cols-[1fr_160px_auto]">
              <input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@example.com"
                className="border border-border bg-input px-3 py-2 text-sm text-foreground"
              />
              <select
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as typeof inviteRole)
                }
                className="border border-border bg-input px-3 py-2 text-sm text-foreground"
              >
                {membersData?.viewer.role === "owner" && <option value="admin">Admin</option>}
                <option value="developer">Developer</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="button"
                disabled={busyKey === "invite" || !inviteEmail.trim()}
                onClick={() => void inviteMember()}
                className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
              >
                {busyKey === "invite" ? "Sending..." : "Invite"}
              </button>
            </div>
          )}
          <div className="divide-y divide-border border border-border">
            {(membersData?.members ?? []).map((member) => {
              const options = membersData
                ? roleOptions(membersData.viewer.role, member.role)
                : [];
              const canEdit = canManageMembers && !member.isCurrentUser && options.length > 0;
              return (
                <div key={member.userId} className="grid gap-3 p-3 md:grid-cols-[1fr_180px_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {member.name || member.username || member.email || member.userId}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {member.email ?? "No email"} · joined {formatDate(member.joinedAt)}
                    </div>
                  </div>
                  {canEdit ? (
                    <select
                      value={member.role}
                      disabled={busyKey === `role:${member.userId}`}
                      onChange={(event) =>
                        void updateMemberRole(
                          member.userId,
                          event.target.value as TeamRole
                        )
                      }
                      className="border border-border bg-input px-3 py-2 text-sm text-foreground"
                    >
                      {options.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                      {member.role}
                    </span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busyKey === `remove:${member.userId}`}
                      onClick={() => void removeMember(member.userId)}
                      className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {membersData?.viewer.role === "owner" && (
        <section className="border border-border/60 bg-card">
          <div className="px-5 pt-5 pb-2">
            <div className="ui-section-title">Ownership</div>
            <div className="ui-section-caption">
              Transfer owner permissions to an existing admin.
            </div>
          </div>
          <div className="grid gap-2 px-5 pb-5 md:grid-cols-[1fr_auto]">
            <select
              value={nextOwnerUserId}
              onChange={(event) => setNextOwnerUserId(event.target.value)}
              className="border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              <option value="">Select an admin</option>
              {ownerTransferCandidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name ||
                    member.username ||
                    member.email ||
                    member.userId}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busyKey === "transfer-owner" || !nextOwnerUserId}
              onClick={() => void transferOwnership()}
              className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {busyKey === "transfer-owner" ? "Transferring..." : "Transfer"}
            </button>
          </div>
        </section>
      )}

      <section className="border border-border/60 bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title">Pending Invites</div>
          <div className="ui-section-caption">Unused invitation links for this team.</div>
        </div>
        <div className="divide-y divide-border">
          {(membersData?.invites ?? []).length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">No pending invites.</div>
          )}
          {(membersData?.invites ?? []).map((invite) => (
            <div key={invite.id} className="grid gap-3 p-3 md:grid-cols-[1fr_120px_auto] md:items-center">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{invite.email}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {invite.role} · expires {formatDate(invite.expiresAt)}
                </div>
              </div>
              <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                pending
              </span>
              {canManageMembers && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void mutateInvite(invite.id, "resend")}
                    className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary"
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => void mutateInvite(invite.id, "revoke")}
                    className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    Revoke
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
