"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingSection } from "@/components/settings/billing-section";
import { useTeamSettingsActions } from "./use-team-settings-actions";
import { MembersTabContent } from "./members-tab-content";
import { KeysTabContent } from "./keys-tab-content";
import { ModelsTabContent } from "./models-tab-content";
import { AuditTabContent } from "./audit-tab-content";
import { TEAM_TAB_SET, type TeamSettingsTab } from "./team-settings-types";

export function TeamSettingsClient({
  teamId,
  teamSlug,
}: {
  teamId: string;
  teamSlug: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab") ?? "";
  const activeTab: TeamSettingsTab = TEAM_TAB_SET.has(tabParam)
    ? (tabParam as TeamSettingsTab)
    : "members";

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

  const resolvedActiveTab =
    activeTab === "audit" && membersData && !canManageMembers
      ? "members"
      : activeTab;

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <div className="min-h-full space-y-4 p-3 md:space-y-6 md:p-6">
      <div>
        <h1 className="ui-page-title">Team Settings</h1>
        <div className="ui-page-subtitle">Manage {membersData?.team.name ?? teamSlug}.</div>
      </div>

      {status && (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
          {status}
        </div>
      )}

      <section className="flex items-center gap-4 border border-border/60 bg-card px-5 py-4">
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

      <Tabs value={resolvedActiveTab} onValueChange={handleTabChange} className="gap-4 md:gap-6">
        <ScrollArea className="w-full">
          <TabsList className="inline-flex h-8 w-max bg-transparent p-0 gap-1">
            <TabsTrigger value="members" className="h-7 px-3 text-[13px]">Members</TabsTrigger>
            <TabsTrigger value="keys" className="h-7 px-3 text-[13px]">Keys</TabsTrigger>
            <TabsTrigger value="models" className="h-7 px-3 text-[13px]">Models</TabsTrigger>
            {canManageMembers && <TabsTrigger value="audit" className="h-7 px-3 text-[13px]">Audit</TabsTrigger>}
            <TabsTrigger value="connections" className="h-7 px-3 text-[13px]">Connections</TabsTrigger>
            <TabsTrigger value="billing" className="h-7 px-3 text-[13px]">Billing</TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <TabsContent value="members" className="mt-0">
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
        </TabsContent>

        <TabsContent value="keys" className="mt-0">
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
        </TabsContent>

        <TabsContent value="models" className="mt-0">
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
        </TabsContent>

        {canManageMembers && (
          <TabsContent value="audit" className="mt-0">
            <AuditTabContent
              auditData={auditData}
              auditError={auditError}
            />
          </TabsContent>
        )}

        <TabsContent value="connections" className="mt-0">
          <section className="border border-border/60 bg-card">
            <div className="px-5 pt-5 pb-2">
              <div className="ui-section-title">Team Connections</div>
              <div className="ui-section-caption">Shared OAuth and MCP connections need a separate ownership model.</div>
            </div>
            <div className="px-5 pb-5 text-sm text-muted-foreground">
              Team-scoped connections are intentionally deferred. Personal connections continue to work from your personal scope.
            </div>
          </section>
        </TabsContent>

        <TabsContent value="billing" className="mt-0">
          <BillingSection embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
