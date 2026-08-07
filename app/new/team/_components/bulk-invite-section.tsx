"use client";

import type { BulkInviteRole } from "@/app/api/teams/[teamId]/invites/bulk/route";
import type { OrgMembersResponse } from "../types";

type BulkInviteSectionProps = {
  bulkInvite: boolean;
  onBulkInviteChange: (checked: boolean) => void;
  bulkInviteRole: BulkInviteRole;
  onBulkInviteRoleChange: (role: BulkInviteRole) => void;
  orgMembers: OrgMembersResponse | null;
  orgMembersLoading: boolean;
  orgMembersError: string | null;
  onLoadOrgMembers: () => void;
  bulkInviteNeedsPreview: boolean;
};

export function BulkInviteSection({
  bulkInvite,
  onBulkInviteChange,
  bulkInviteRole,
  onBulkInviteRoleChange,
  orgMembers,
  orgMembersLoading,
  orgMembersError,
  onLoadOrgMembers,
  bulkInviteNeedsPreview,
}: BulkInviteSectionProps) {
  const orgMembersWithEmail = orgMembers
    ? orgMembers.members.filter((m) => m.email).length
    : null;

  return (
    <div className="border-border space-y-2 border-t pt-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={bulkInvite}
          onChange={(e) => onBulkInviteChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="text-foreground block text-xs font-medium">
            Send invites to org members
          </span>
          <span className="text-muted-foreground block text-[11px]">
            One-time. We will not keep this in sync with GitHub.
          </span>
        </span>
      </label>

      {bulkInvite && (
        <div className="space-y-2 pl-6">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-[11px]">
              Invite as:
            </span>
            <select
              value={bulkInviteRole}
              onChange={(e) =>
                onBulkInviteRoleChange(e.target.value as BulkInviteRole)
              }
              className="border-border bg-card focus-visible:ring-ring rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2"
            >
              <option value="developer">Developer</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <button
            type="button"
            onClick={onLoadOrgMembers}
            disabled={orgMembersLoading}
            className="border-border text-foreground hover:bg-secondary rounded-md border px-2 py-1 text-xs disabled:opacity-50"
          >
            {orgMembersLoading
              ? "Loading members..."
              : orgMembers
                ? "Refresh members"
                : "Preview members"}
          </button>

          {orgMembersError && (
            <p className="text-destructive text-[11px]">{orgMembersError}</p>
          )}

          {bulkInviteNeedsPreview && !orgMembersError && !orgMembersLoading && (
            <p className="text-[11px] text-amber-500">
              Preview members before creating the team so invites can be sent.
            </p>
          )}

          {orgMembers && orgMembersWithEmail !== null && (
            <p className="text-muted-foreground text-[11px]">
              {orgMembersWithEmail} member
              {orgMembersWithEmail === 1 ? "" : "s"} with a public email
              {orgMembers.no_email_count > 0 ? (
                <>
                  {" · "}
                  <span className="text-amber-500">
                    {orgMembers.no_email_count} have no public email (invite
                    manually)
                  </span>
                </>
              ) : null}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
