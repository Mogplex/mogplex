"use client";

import type { BulkInviteRole } from "@/app/api/teams/[teamId]/invites/bulk/route";
import type { Installation, OrgMembersResponse } from "../types";
import { BulkInviteSection } from "./bulk-invite-section";

type InstallationSectionProps = {
  installations: Installation[];
  attachInstallation: boolean;
  onAttachInstallationChange: (checked: boolean) => void;
  selectedInstallationId: number | null;
  onSelectedInstallationIdChange: (id: number | null) => void;
  selectedIsOrg: boolean;
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

export function InstallationSection({
  installations,
  attachInstallation,
  onAttachInstallationChange,
  selectedInstallationId,
  onSelectedInstallationIdChange,
  selectedIsOrg,
  bulkInvite,
  onBulkInviteChange,
  bulkInviteRole,
  onBulkInviteRoleChange,
  orgMembers,
  orgMembersLoading,
  orgMembersError,
  onLoadOrgMembers,
  bulkInviteNeedsPreview,
}: InstallationSectionProps) {
  if (installations.length === 0) {
    return null;
  }

  return (
    <div className="border-border bg-card/40 space-y-3 rounded-md border p-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={attachInstallation}
          onChange={(e) => onAttachInstallationChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="text-foreground block text-xs font-medium">
            Attach a GitHub installation
          </span>
          <span className="text-muted-foreground block text-[11px]">
            Lets this team see repos installed under the selected account.
          </span>
        </span>
      </label>

      {attachInstallation && (
        <select
          value={
            selectedInstallationId !== null
              ? String(selectedInstallationId)
              : ""
          }
          onChange={(e) =>
            onSelectedInstallationIdChange(
              e.target.value ? Number(e.target.value) : null
            )
          }
          className="border-border bg-card focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
        >
          {installations.map((inst) => (
            <option
              key={inst.installation_id}
              value={String(inst.installation_id)}
            >
              {inst.account_login ?? `Installation ${inst.installation_id}`} (
              {inst.scope_label || inst.target_type || "Account"})
            </option>
          ))}
        </select>
      )}

      {attachInstallation && selectedIsOrg && (
        <BulkInviteSection
          bulkInvite={bulkInvite}
          onBulkInviteChange={onBulkInviteChange}
          bulkInviteRole={bulkInviteRole}
          onBulkInviteRoleChange={onBulkInviteRoleChange}
          orgMembers={orgMembers}
          orgMembersLoading={orgMembersLoading}
          orgMembersError={orgMembersError}
          onLoadOrgMembers={onLoadOrgMembers}
          bulkInviteNeedsPreview={bulkInviteNeedsPreview}
        />
      )}
    </div>
  );
}
