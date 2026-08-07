"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { useModels } from "@/hooks/use-models";
import { useMemberships } from "@/hooks/use-memberships";
import { fetchTeamSettingsJson } from "./team-settings-helpers";
import type { TeamKeysResponse } from "./team-settings-types";
import type { TeamAuditEventsResponse } from "@/app/api/teams/[teamId]/audit-events/route";
import type { TeamMembersResponse } from "@/app/api/teams/[teamId]/members/route";
import type { TeamModelsResponse } from "@/app/api/teams/[teamId]/models/route";
import type { TeamRole } from "@/lib/team-capabilities";
import type { Provider } from "@/lib/vault";

export function useTeamSettingsActions(teamId: string) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "admin" | "developer" | "viewer"
  >("developer");
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
  const canManageIcon = canManageMembers;
  const canManageKeys = keysData?.viewer.canManage === true;
  const canManageModels = teamModels?.viewer.canManage === true;
  const configuredProviders = useMemo(
    () => new Set((keysData?.keys ?? []).map((key) => key.provider)),
    [keysData]
  );
  const ownerTransferCandidates = useMemo(
    () =>
      (membersData?.members ?? []).filter(
        (m) => !m.isCurrentUser && m.role === "admin"
      ),
    [membersData?.members]
  );

  const { data: auditData, error: auditError } =
    useSWR<TeamAuditEventsResponse>(
      canManageMembers ? auditKey : null,
      (url: string) =>
        fetchTeamSettingsJson<TeamAuditEventsResponse>(teamId, url)
    );

  useEffect(() => {
    if (!teamModels) return;
    setRestrictModels(teamModels.modelAllowlist !== null);
    setSelectedModels(new Set(teamModels.modelAllowlist));
  }, [teamModels]);
  useEffect(() => {
    if (
      nextOwnerUserId &&
      !ownerTransferCandidates.some((m) => m.userId === nextOwnerUserId)
    )
      setNextOwnerUserId("");
  }, [nextOwnerUserId, ownerTransferCandidates]);

  const postJson = useCallback(
    async (url: string, body?: unknown) => {
      const response = await fetch(url, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          teamId
        ),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Request failed");
      }
      return payload;
    },
    [teamId]
  );

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
              { "Content-Type": "application/json" },
              teamId
            ),
            body: JSON.stringify({ role }),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(payload.error || "Role update failed");
        await mutateMembers();
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Role update failed"
        );
      } finally {
        setBusyKey(null);
      }
    },
    [mutateMembers, teamId]
  );

  const removeMember = useCallback(
    async (memberUserId: string) => {
      // eslint-disable-next-line no-alert -- intentional confirmation dialog
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
      nextOwner?.name ||
      nextOwner?.username ||
      nextOwner?.email ||
      "this admin";
    // eslint-disable-next-line no-alert -- intentional confirmation dialog
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
    // eslint-disable-next-line no-alert -- intentional confirmation dialog
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
      setStatus(error instanceof Error ? error.message : "Icon removal failed");
    } finally {
      setBusyKey(null);
    }
  }, [mutateMembers, mutateMemberships, teamId]);

  const mutateInvite = useCallback(
    async (inviteId: string, action: "resend" | "revoke") => {
      setBusyKey(`${action}:${inviteId}`);
      setStatus(null);
      try {
        const response = await fetch(
          `/api/teams/${teamId}/invites/${inviteId}`,
          {
            method: action === "resend" ? "POST" : "DELETE",
            headers: getActiveTeamRequestHeaders(undefined, teamId),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(payload.error || "Invite update failed");
        await mutateMembers();
        setStatus(
          action === "resend" ? "Invitation resent." : "Invitation revoked."
        );
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Invite update failed"
        );
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
            { "Content-Type": "application/json" },
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
            { "Content-Type": "application/json" },
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
          { "Content-Type": "application/json" },
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

  return {
    inviteEmail,
    setInviteEmail,
    inviteRole,
    setInviteRole,
    status,
    busyKey,
    keyInputs,
    setKeyInputs,
    restrictModels,
    setRestrictModels,
    selectedModels,
    setSelectedModels,
    nextOwnerUserId,
    setNextOwnerUserId,
    iconInputRef,
    membersData,
    membersError,
    keysData,
    keysError,
    teamModels,
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
  };
}
