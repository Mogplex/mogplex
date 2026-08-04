"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { fetchJsonObject } from "@/lib/client-fetch";
import { formatTeamAuditPayload } from "@/lib/team-audit-presentation";
import { useModels } from "@/hooks/use-models";
import { useMemberships } from "@/hooks/use-memberships";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingSection } from "@/components/settings/billing-section";
import type { TeamAuditEventsResponse } from "@/app/api/teams/[teamId]/audit-events/route";
import type { TeamMembersResponse } from "@/app/api/teams/[teamId]/members/route";
import type { TeamModelsResponse } from "@/app/api/teams/[teamId]/models/route";
import type { TeamRole } from "@/lib/team-capabilities";
import type { Provider } from "@/lib/vault";

type TeamSettingsTab =
  | "members"
  | "keys"
  | "models"
  | "audit"
  | "connections"
  | "billing";

type TeamKeysResponse = {
  keys: Array<{ provider: Provider; created_at: string; updated_at: string }>;
  viewer: { role: TeamRole; canManage: boolean };
};

const TEAM_TABS = [
  "members",
  "keys",
  "models",
  "audit",
  "connections",
  "billing",
] as const;
const TEAM_TAB_SET: ReadonlySet<string> = new Set(TEAM_TABS);

const PROVIDERS: Array<{
  id: Provider;
  label: string;
  placeholder: string;
}> = [
  { id: "ai_gateway", label: "AI Gateway", placeholder: "Paste Gateway key" },
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
];

function fetchTeamSettingsJson<T extends Record<string, unknown>>(
  teamId: string,
  url: string
) {
  return fetchJsonObject<T>(url, "Failed to load team settings", {
    headers: getActiveTeamRequestHeaders(undefined, teamId),
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAuditAction(action: string) {
  return action.replace(/\./g, " ");
}

function roleOptions(viewerRole: TeamRole, targetRole: TeamRole) {
  if (targetRole === "owner") return [];
  if (viewerRole === "owner") return ["admin", "developer", "viewer"] as const;
  if (viewerRole === "admin" && targetRole !== "admin") {
    return ["developer", "viewer"] as const;
  }
  return [];
}

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

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<"admin" | "developer" | "viewer">("developer");
  const [status, setStatus] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [restrictModels, setRestrictModels] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    () => new Set()
  );
  const [nextOwnerUserId, setNextOwnerUserId] = useState("");
  const iconInputRef = useRef<HTMLInputElement | null>(null);

  const membersKey = `/api/teams/${teamId}/members`;
  const keysKey = `/api/teams/${teamId}/keys`;
  const modelsKey = `/api/teams/${teamId}/models`;
  const auditKey = `/api/teams/${teamId}/audit-events`;

  const {
    data: membersData,
    error: membersError,
    mutate: mutateMembers,
  } = useSWR<TeamMembersResponse>(membersKey, (url: string) =>
    fetchTeamSettingsJson<TeamMembersResponse>(teamId, url)
  );
  const {
    data: keysData,
    error: keysError,
    mutate: mutateKeys,
  } = useSWR<TeamKeysResponse>(keysKey, (url: string) =>
    fetchTeamSettingsJson<TeamKeysResponse>(teamId, url)
  );
  const {
    data: teamModels,
    error: modelsError,
    mutate: mutateTeamModels,
  } = useSWR<TeamModelsResponse>(modelsKey, (url: string) =>
    fetchTeamSettingsJson<TeamModelsResponse>(teamId, url)
  );
  const { catalog, mutate: mutateModels } = useModels();
  const { mutate: mutateMemberships } = useMemberships();

  const canManageMembers = membersData?.viewer.canManage === true;
  // Icon mutations go through the same RLS path as member management
  // (owner/admin only). Aliased so the dependency is obvious in the JSX,
  // and so the two capabilities can diverge cleanly later if needed.
  const canManageIcon = canManageMembers;
  const canManageKeys = keysData?.viewer.canManage === true;
  const canManageModels = teamModels?.viewer.canManage === true;
  const resolvedActiveTab =
    activeTab === "audit" && membersData && !canManageMembers
      ? "members"
      : activeTab;
  const configuredProviders = useMemo(
    () => new Set((keysData?.keys ?? []).map((key) => key.provider)),
    [keysData]
  );
  const ownerTransferCandidates = useMemo(
    () =>
      (membersData?.members ?? []).filter(
        (member) => !member.isCurrentUser && member.role === "admin"
      ),
    [membersData?.members]
  );
  const {
    data: auditData,
    error: auditError,
  } = useSWR<TeamAuditEventsResponse>(
    canManageMembers ? auditKey : null,
    (url: string) => fetchTeamSettingsJson<TeamAuditEventsResponse>(teamId, url)
  );

  useEffect(() => {
    if (!teamModels) return;
    setRestrictModels(teamModels.modelAllowlist !== null);
    setSelectedModels(new Set(teamModels.modelAllowlist ?? []));
  }, [teamModels]);

  useEffect(() => {
    if (
      nextOwnerUserId &&
      !ownerTransferCandidates.some((member) => member.userId === nextOwnerUserId)
    ) {
      setNextOwnerUserId("");
    }
  }, [nextOwnerUserId, ownerTransferCandidates]);

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const postJson = useCallback(async (url: string, body?: unknown) => {
    const response = await fetch(url, {
      method: "POST",
      headers: getActiveTeamRequestHeaders(
        {
          "Content-Type": "application/json",
        },
        teamId
      ),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }, [teamId]);

  const inviteMember = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    setBusyKey("invite");
    setStatus(null);
    try {
      await postJson(`/api/teams/${teamId}/invites`, {
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteRole("developer");
      await mutateMembers();
      setStatus("Invitation sent.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invite failed");
    } finally {
      setBusyKey(null);
    }
  }, [inviteEmail, inviteRole, mutateMembers, postJson, teamId]);

  const updateMemberRole = useCallback(
    async (memberUserId: string, role: TeamRole) => {
      setBusyKey(`role:${memberUserId}`);
      setStatus(null);
      try {
        const response = await fetch(
          `/api/teams/${teamId}/members/${memberUserId}`,
          {
            method: "PATCH",
            headers: getActiveTeamRequestHeaders(
              {
                "Content-Type": "application/json",
              },
              teamId
            ),
            body: JSON.stringify({ role }),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Role update failed");
        await mutateMembers();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Role update failed");
      } finally {
        setBusyKey(null);
      }
    },
    [mutateMembers, teamId]
  );

  const removeMember = useCallback(
    async (memberUserId: string) => {
      if (!window.confirm("Remove this member from the team?")) return;
      setBusyKey(`remove:${memberUserId}`);
      setStatus(null);
      try {
        const response = await fetch(
          `/api/teams/${teamId}/members/${memberUserId}`,
          {
            method: "DELETE",
            headers: getActiveTeamRequestHeaders(undefined, teamId),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Remove failed");
        await mutateMembers();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Remove failed");
      } finally {
        setBusyKey(null);
      }
    },
    [mutateMembers, teamId]
  );

  const transferOwnership = useCallback(async () => {
    if (!nextOwnerUserId) return;
    const nextOwner = ownerTransferCandidates.find(
      (member) => member.userId === nextOwnerUserId
    );
    const label =
      nextOwner?.name || nextOwner?.username || nextOwner?.email || "this admin";
    if (!window.confirm(`Transfer team ownership to ${label}?`)) return;

    setBusyKey("transfer-owner");
    setStatus(null);
    try {
      const response = await fetch(`/api/teams/${teamId}/ownership`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          teamId
        ),
        body: JSON.stringify({ next_owner_user_id: nextOwnerUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Ownership transfer failed");
      }
      setNextOwnerUserId("");
      await mutateMembers();
      setStatus("Ownership transferred.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Ownership transfer failed"
      );
    } finally {
      setBusyKey(null);
    }
  }, [mutateMembers, nextOwnerUserId, ownerTransferCandidates, teamId]);

  const uploadTeamIcon = useCallback(
    async (file: File) => {
      setBusyKey("icon");
      setStatus(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/teams/${teamId}/icon`, {
          method: "POST",
          headers: getActiveTeamRequestHeaders(undefined, teamId),
          body: form,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Icon upload failed");
        }
        await Promise.all([mutateMembers(), mutateMemberships()]);
        setStatus("Team icon updated.");
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Icon upload failed"
        );
      } finally {
        setBusyKey(null);
        if (iconInputRef.current) iconInputRef.current.value = "";
      }
    },
    [mutateMembers, mutateMemberships, teamId]
  );

  const removeTeamIcon = useCallback(async () => {
    if (!window.confirm("Remove the team icon?")) return;
    setBusyKey("icon");
    setStatus(null);
    try {
      const response = await fetch(`/api/teams/${teamId}/icon`, {
        method: "DELETE",
        headers: getActiveTeamRequestHeaders(undefined, teamId),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Icon removal failed");
      }
      await Promise.all([mutateMembers(), mutateMemberships()]);
      setStatus("Team icon removed.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Icon removal failed"
      );
    } finally {
      setBusyKey(null);
    }
  }, [mutateMembers, mutateMemberships, teamId]);

  const mutateInvite = useCallback(
    async (inviteId: string, action: "resend" | "revoke") => {
      setBusyKey(`${action}:${inviteId}`);
      setStatus(null);
      try {
        const response = await fetch(`/api/teams/${teamId}/invites/${inviteId}`, {
          method: action === "resend" ? "POST" : "DELETE",
          headers: getActiveTeamRequestHeaders(undefined, teamId),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Invite update failed");
        await mutateMembers();
        setStatus(action === "resend" ? "Invitation resent." : "Invitation revoked.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Invite update failed");
      } finally {
        setBusyKey(null);
      }
    },
    [mutateMembers, teamId]
  );

  const saveProviderKey = useCallback(
    async (provider: Provider) => {
      const key = keyInputs[provider]?.trim();
      if (!key) return;
      setBusyKey(`key:${provider}`);
      setStatus(null);
      try {
        const response = await fetch(keysKey, {
          method: "PUT",
          headers: getActiveTeamRequestHeaders(
            {
              "Content-Type": "application/json",
            },
            teamId
          ),
          body: JSON.stringify({ provider, key }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Key save failed");
        setKeyInputs((current) => ({ ...current, [provider]: "" }));
        await mutateKeys();
        await mutateModels();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Key save failed");
      } finally {
        setBusyKey(null);
      }
    },
    [keyInputs, keysKey, mutateKeys, mutateModels, teamId]
  );

  const deleteProviderKey = useCallback(
    async (provider: Provider) => {
      setBusyKey(`key:${provider}`);
      setStatus(null);
      try {
        const response = await fetch(keysKey, {
          method: "DELETE",
          headers: getActiveTeamRequestHeaders(
            {
              "Content-Type": "application/json",
            },
            teamId
          ),
          body: JSON.stringify({ provider }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Key delete failed");
        await mutateKeys();
        await mutateModels();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Key delete failed");
      } finally {
        setBusyKey(null);
      }
    },
    [keysKey, mutateKeys, mutateModels, teamId]
  );

  const saveModelAllowlist = useCallback(async () => {
    setBusyKey("models");
    setStatus(null);
    try {
      const response = await fetch(modelsKey, {
        method: "PATCH",
        headers: getActiveTeamRequestHeaders(
          {
            "Content-Type": "application/json",
          },
          teamId
        ),
        body: JSON.stringify({
          model_allowlist: restrictModels ? [...selectedModels] : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Model allowlist save failed");
      }
      await mutateTeamModels();
      await mutateModels();
      setStatus("Model allowlist saved.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Model allowlist save failed"
      );
    } finally {
      setBusyKey(null);
    }
  }, [
    modelsKey,
    mutateModels,
    mutateTeamModels,
    restrictModels,
    selectedModels,
    teamId,
  ]);

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

        <TabsContent value="members" className="mt-0 space-y-4">
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
        </TabsContent>

        <TabsContent value="keys" className="mt-0">
          <section className="border border-border/60 bg-card">
            <div className="px-5 pt-5 pb-2">
              <div className="ui-section-title">Team Keys</div>
              <div className="ui-section-caption">Shared provider keys are preferred over personal keys inside this team.</div>
            </div>
            <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
              {keysError && <div className="text-sm text-destructive">Unable to load keys.</div>}
              {PROVIDERS.map((provider) => {
                const configured = configuredProviders.has(provider.id);
                return (
                  <div key={provider.id} className="border border-border bg-background/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{provider.label}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {configured ? "Set for this team" : "Not set"}
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${configured ? "bg-accent-green/10 text-accent-green" : "bg-secondary text-muted-foreground"}`}>
                        {configured ? "Set" : "Empty"}
                      </span>
                    </div>
                    {canManageKeys && (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="password"
                          value={keyInputs[provider.id] ?? ""}
                          onChange={(event) =>
                            setKeyInputs((current) => ({
                              ...current,
                              [provider.id]: event.target.value,
                            }))
                          }
                          placeholder={provider.placeholder}
                          className="min-w-0 flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground"
                        />
                        <button
                          type="button"
                          disabled={busyKey === `key:${provider.id}`}
                          onClick={() => void saveProviderKey(provider.id)}
                          className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
                        >
                          Save
                        </button>
                        {configured && (
                          <button
                            type="button"
                            disabled={busyKey === `key:${provider.id}`}
                            onClick={() => void deleteProviderKey(provider.id)}
                            className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="models" className="mt-0">
          <section className="border border-border/60 bg-card">
            <div className="px-5 pt-5 pb-2">
              <div className="ui-section-title">Model Allowlist</div>
              <div className="ui-section-caption">Limit which catalog models members can run in this team.</div>
            </div>
            <div className="space-y-4 px-5 pb-5">
              {modelsError && <div className="text-sm text-destructive">Unable to load model settings.</div>}
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={restrictModels}
                  disabled={!canManageModels}
                  onChange={(event) => setRestrictModels(event.target.checked)}
                />
                Restrict this team to selected models
              </label>
              <div className="grid max-h-[460px] gap-2 overflow-auto border border-border p-3 md:grid-cols-2">
                {catalog.map((model) => (
                  <label key={model.id} className="flex items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-secondary/60">
                    <input
                      type="checkbox"
                      disabled={!restrictModels || !canManageModels}
                      checked={selectedModels.has(model.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelectedModels((current) => {
                          const next = new Set(current);
                          if (checked) next.add(model.id);
                          else next.delete(model.id);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{model.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{model.id}</span>
                    </span>
                  </label>
                ))}
              </div>
              {canManageModels ? (
                <button
                  type="button"
                  disabled={busyKey === "models"}
                  onClick={() => void saveModelAllowlist()}
                  className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
                >
                  {busyKey === "models" ? "Saving..." : "Save model allowlist"}
                </button>
              ) : (
                <div className="text-sm text-muted-foreground">Only owners and admins can change the allowlist.</div>
              )}
            </div>
          </section>
        </TabsContent>

        {canManageMembers && (
          <TabsContent value="audit" className="mt-0">
            <section className="border border-border/60 bg-card">
              <div className="px-5 pt-5 pb-2">
                <div className="ui-section-title">Audit Log</div>
                <div className="ui-section-caption">Team administration and denied-action events.</div>
              </div>
              <div className="divide-y divide-border">
                {auditError && (
                  <div className="p-4 text-sm text-destructive">Unable to load audit events.</div>
                )}
                {(auditData?.events ?? []).length === 0 && !auditError && (
                  <div className="p-4 text-sm text-muted-foreground">No audit events yet.</div>
                )}
                {(auditData?.events ?? []).map((event) => {
                  const payloadSummary = formatTeamAuditPayload(event.payload);
                  return (
                    <div key={event.id} className="grid gap-2 p-3 md:grid-cols-[180px_1fr_140px] md:items-start">
                      <div className="text-[12px] text-muted-foreground">
                        {formatDateTime(event.createdAt)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {formatAuditAction(event.action)}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          {event.targetType}
                          {event.targetId ? ` · ${event.targetId}` : ""}
                        </div>
                        {payloadSummary && (
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            {payloadSummary}
                          </div>
                        )}
                      </div>
                      {event.decisionCode ? (
                        <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                          {event.decisionCode.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                          recorded
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
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
