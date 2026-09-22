"use client";

import { DecisionChecksSection } from "@/components/settings/decision-checks-section";
import { useTeamSettingsActions } from "./use-team-settings-actions";
import { MembersTabContent } from "./members-tab-content";
import { KeysTabContent } from "./keys-tab-content";
import { ModelsTabContent } from "./models-tab-content";
import { AuditTabContent } from "./audit-tab-content";

export function TeamSettingsClient({
  teamId,
  teamSlug,
  section,
}: {
  teamId: string;
  teamSlug: string;
  section: "members" | "keys" | "models" | "audit";
}) {
  const actions = useTeamSettingsActions(teamId);
  const {
    status,
    busyKey,
    membersData,
    membersError,
    keysError,
    modelsError,
    auditData,
    auditError,
    catalog,
    canManageMembers,
    canManageIcon,
    canManageKeys,
    canManageModels,
    configuredProviders,
    ownerTransferCandidates,
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    keyInputs,
    setKeyInputs,
    restrictModels,
    setRestrictModels,
    selectedModels,
    setSelectedModels,
    nextOwnerUserId,
    setNextOwnerUserId,
    iconInputRef,
    inviteMember,
    updateMemberRole,
    removeMember,
    transferOwnership,
    uploadTeamIcon,
    removeTeamIcon,
    mutateInvite,
    saveProviderKey,
    deleteProviderKey,
    saveModelAllowlist,
  } = actions;

  const title = { members: "Members", keys: "Provider Keys", models: "Models", audit: "Audit" }[section];

  return (
    <div className="min-h-full w-full max-w-[1488px] space-y-4 p-3 md:space-y-6 md:p-6">
      <div>
        <h1 className="ui-page-title">{title}</h1>
        <div className="ui-page-subtitle">{membersData?.team.name ?? teamSlug}</div>
      </div>

      {status && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
          {status}
        </div>
      )}

      {section === "members" && (
        <section className="flex flex-wrap items-center gap-4 border border-border/60 bg-card px-5 py-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent text-sm font-medium text-foreground/80"
            aria-hidden="true"
          >
            {membersData?.team.iconUrl ? (
              <img
                src={membersData.team.iconUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span>
                {(membersData?.team.name ?? teamSlug)
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? "")
                  .join("") || "?"}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="ui-section-title">Team icon</div>
            <div className="ui-section-caption">
              PNG, JPG, WEBP, or GIF · up to 2 MB · square works best.
            </div>
          </div>
          {canManageIcon && (
            <div className="flex items-center gap-2">
              <input
                ref={iconInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadTeamIcon(file);
                }}
              />
              <button
                type="button"
                disabled={busyKey === "icon"}
                onClick={() => iconInputRef.current?.click()}
                className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
              >
                {busyKey === "icon"
                  ? "Uploading…"
                  : membersData?.team.iconUrl
                    ? "Replace"
                    : "Upload"}
              </button>
              {membersData?.team.iconUrl && (
                <button
                  type="button"
                  disabled={busyKey === "icon"}
                  onClick={() => void removeTeamIcon()}
                  className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {section === "members" && (
        <MembersTabContent
          teamSlug={teamSlug}
          membersData={membersData}
          membersError={membersError}
          canManageMembers={canManageMembers}
          canManageIcon={canManageIcon}
          busyKey={busyKey}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviteRole={inviteRole}
          setInviteRole={setInviteRole}
          inviteMember={inviteMember}
          updateMemberRole={updateMemberRole}
          removeMember={removeMember}
          mutateInvite={mutateInvite}
          nextOwnerUserId={nextOwnerUserId}
          setNextOwnerUserId={setNextOwnerUserId}
          ownerTransferCandidates={ownerTransferCandidates}
          transferOwnership={transferOwnership}
          uploadTeamIcon={uploadTeamIcon}
          removeTeamIcon={removeTeamIcon}
          iconInputRef={iconInputRef}
        />
      )}

      {section === "keys" && (
        <KeysTabContent
          keysError={keysError}
          canManageKeys={canManageKeys}
          busyKey={busyKey}
          configuredProviders={configuredProviders}
          keyInputs={keyInputs}
          setKeyInputs={setKeyInputs}
          saveProviderKey={saveProviderKey}
          deleteProviderKey={deleteProviderKey}
        />
      )}

      {section === "models" && (
        <div>
          <ModelsTabContent
            modelsError={modelsError}
            canManageModels={canManageModels}
            busyKey={busyKey}
            restrictModels={restrictModels}
            setRestrictModels={setRestrictModels}
            selectedModels={selectedModels}
            setSelectedModels={setSelectedModels}
            catalog={catalog}
            saveModelAllowlist={saveModelAllowlist}
          />
          <div className="mt-4 md:mt-6">
            <DecisionChecksSection
              endpoint={`/api/teams/${teamId}/decision-checks`}
              audience="team"
            />
          </div>
        </div>
      )}

      {section === "audit" && (
        canManageMembers ? <AuditTabContent auditData={auditData} auditError={auditError} /> :
          <p className="text-sm text-muted-foreground" role="status">
            {membersError ? "Unable to load team permissions." : membersData ? "Only a team owner or admin can view the audit log." : "Loading team permissions…"}
          </p>
      )}
    </div>
  );
}
