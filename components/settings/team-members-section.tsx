"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider"
import { fetchJsonObject } from "@/lib/client-fetch"
import type { TeamMembersResponse } from "@/app/api/teams/[teamId]/members/route"
import type { TeamRole } from "@/lib/team-capabilities"
import { formatTeamRole } from "@/lib/team-role-label"

// Every fetch in this component must pass an explicit `teamId` to
// getActiveTeamRequestHeaders. The module-level activeTeamId singleton is set
// only by team-scope ActiveScopeProvider; in personal scope (TeamsListSection)
// it stays null, and multiple TeamMembersSection instances can be mounted at
// once. Dropping the explicit teamId would silently target the wrong team.
function fetchTeamSettingsJson<T extends Record<string, unknown>>(
  teamId: string,
  url: string,
) {
  return fetchJsonObject<T>(url, "Failed to load team settings", {
    headers: getActiveTeamRequestHeaders(undefined, teamId),
  })
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function roleOptions(viewerRole: TeamRole, targetRole: TeamRole) {
  if (targetRole === "owner") return [] as readonly TeamRole[]
  if (viewerRole === "owner") return ["admin", "developer", "viewer"] as const
  if (viewerRole === "admin" && targetRole !== "admin") {
    return ["developer", "viewer"] as const
  }
  return [] as readonly TeamRole[]
}

export function TeamMembersSection({ teamId }: { teamId: string }) {
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "developer" | "viewer">(
    "developer",
  )
  const [status, setStatus] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [nextOwnerUserId, setNextOwnerUserId] = useState("")

  const membersKey = `/api/teams/${teamId}/members`

  const {
    data: membersData,
    error: membersError,
    mutate: mutateMembers,
  } = useSWR<TeamMembersResponse>(membersKey, (url: string) =>
    fetchTeamSettingsJson<TeamMembersResponse>(teamId, url),
  )

  const canManageMembers = membersData?.viewer.canManage === true

  const ownerTransferCandidates = useMemo(
    () =>
      (membersData?.members ?? []).filter(
        (member) => !member.isCurrentUser && member.role === "admin",
      ),
    [membersData?.members],
  )

  useEffect(() => {
    if (
      nextOwnerUserId &&
      !ownerTransferCandidates.some(
        (member) => member.userId === nextOwnerUserId,
      )
    ) {
      setNextOwnerUserId("")
    }
  }, [nextOwnerUserId, ownerTransferCandidates])

  // teamId must remain an explicit argument here — see file-header comment.
  const postJson = useCallback(
    async (url: string, body?: unknown) => {
      const response = await fetch(url, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          teamId,
        ),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || "Request failed")
      }
      return payload
    },
    [teamId],
  )

  const inviteMember = useCallback(async () => {
    if (!inviteEmail.trim()) return
    setBusyKey("invite")
    setStatus(null)
    try {
      await postJson(`/api/teams/${teamId}/invites`, {
        email: inviteEmail,
        role: inviteRole,
      })
      setInviteEmail("")
      setInviteRole("developer")
      await mutateMembers()
      setStatus("Invitation sent.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invite failed")
    } finally {
      setBusyKey(null)
    }
  }, [inviteEmail, inviteRole, mutateMembers, postJson, teamId])

  const updateMemberRole = useCallback(
    async (memberUserId: string, role: TeamRole) => {
      setBusyKey(`role:${memberUserId}`)
      setStatus(null)
      try {
        const response = await fetch(
          `/api/teams/${teamId}/members/${memberUserId}`,
          {
            method: "PATCH",
            headers: getActiveTeamRequestHeaders(
              { "Content-Type": "application/json" },
              teamId,
            ),
            body: JSON.stringify({ role }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || "Role update failed")
        await mutateMembers()
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Role update failed")
      } finally {
        setBusyKey(null)
      }
    },
    [mutateMembers, teamId],
  )

  const removeMember = useCallback(
    async (memberUserId: string) => {
      if (!window.confirm("Remove this member from the team?")) return
      setBusyKey(`remove:${memberUserId}`)
      setStatus(null)
      try {
        const response = await fetch(
          `/api/teams/${teamId}/members/${memberUserId}`,
          {
            method: "DELETE",
            headers: getActiveTeamRequestHeaders(undefined, teamId),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || "Remove failed")
        await mutateMembers()
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Remove failed")
      } finally {
        setBusyKey(null)
      }
    },
    [mutateMembers, teamId],
  )

  const transferOwnership = useCallback(async () => {
    if (!nextOwnerUserId) return
    const nextOwner = ownerTransferCandidates.find(
      (member) => member.userId === nextOwnerUserId,
    )
    const label =
      nextOwner?.name || nextOwner?.username || nextOwner?.email || "this admin"
    if (!window.confirm(`Transfer team ownership to ${label}?`)) return

    setBusyKey("transfer-owner")
    setStatus(null)
    try {
      const response = await fetch(`/api/teams/${teamId}/ownership`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          teamId,
        ),
        body: JSON.stringify({ next_owner_user_id: nextOwnerUserId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || "Ownership transfer failed")
      }
      setNextOwnerUserId("")
      await mutateMembers()
      setStatus("Ownership transferred.")
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Ownership transfer failed",
      )
    } finally {
      setBusyKey(null)
    }
  }, [mutateMembers, nextOwnerUserId, ownerTransferCandidates, teamId])

  const mutateInvite = useCallback(
    async (inviteId: string, action: "resend" | "revoke") => {
      if (
        action === "revoke" &&
        !window.confirm("Revoke this invitation? The link will stop working.")
      ) {
        return
      }
      setBusyKey(`${action}:${inviteId}`)
      setStatus(null)
      try {
        const response = await fetch(
          `/api/teams/${teamId}/invites/${inviteId}`,
          {
            method: action === "resend" ? "POST" : "DELETE",
            headers: getActiveTeamRequestHeaders(undefined, teamId),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || "Invite update failed")
        await mutateMembers()
        setStatus(
          action === "resend" ? "Invitation resent." : "Invitation revoked.",
        )
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Invite update failed")
      } finally {
        setBusyKey(null)
      }
    },
    [mutateMembers, teamId],
  )

  return (
    <div className="space-y-9">
      {status && (
        <div className="border border-border bg-background/60 p-3 text-sm text-foreground">
          {status}
        </div>
      )}

      <section>
        <div className="ui-section-title">Members</div>
        <div className="ui-section-caption">
          Team roles control model, tool, and sandbox permissions.
        </div>
        <div className="mt-4 space-y-3">
          {membersError && (
            <div className="text-sm text-destructive">Unable to load members.</div>
          )}
          {canManageMembers && (
            <div className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
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
                {membersData?.viewer.role === "owner" && (
                  <option value="admin">Admin</option>
                )}
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
          <div>
            {(membersData?.members ?? []).map((member) => {
              const options = membersData
                ? roleOptions(membersData.viewer.role, member.role)
                : ([] as readonly TeamRole[])
              const canEdit =
                canManageMembers && !member.isCurrentUser && options.length > 0
              return (
                <div
                  key={member.userId}
                  className="grid gap-3 border-b border-border/40 py-3 last:border-b-0 md:grid-cols-[1fr_180px_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {member.name ||
                        member.username ||
                        member.email ||
                        member.userId}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {member.email ?? "No email"} · joined{" "}
                      {formatDate(member.joinedAt)}
                    </div>
                  </div>
                  {canEdit ? (
                    <select
                      value={member.role}
                      disabled={busyKey === `role:${member.userId}`}
                      onChange={(event) =>
                        void updateMemberRole(
                          member.userId,
                          event.target.value as TeamRole,
                        )
                      }
                      className="border border-border bg-input px-3 py-2 text-sm text-foreground"
                    >
                      {options.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                      {formatTeamRole(member.role)}
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
              )
            })}
          </div>
        </div>
      </section>

      {membersData?.viewer.role === "owner" && (
        <section>
          <div className="ui-section-title">Ownership</div>
          <div className="ui-section-caption">
            Transfer owner permissions to an existing admin.
          </div>
          <div className="mt-4 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <select
                value={nextOwnerUserId}
                onChange={(event) => setNextOwnerUserId(event.target.value)}
                disabled={ownerTransferCandidates.length === 0}
                className="border border-border bg-input px-3 py-2 text-sm text-foreground disabled:opacity-50"
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
            {ownerTransferCandidates.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Promote a member to Admin before transferring ownership.
              </p>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="ui-section-title">Pending Invites</div>
        <div className="ui-section-caption">
          Unused invitation links for this team.
        </div>
        <div className="mt-4">
          {(membersData?.invites ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground">
              No pending invites.
            </div>
          )}
          {(membersData?.invites ?? []).map((invite) => (
            <div
              key={invite.id}
              className="grid gap-3 border-b border-border/40 py-3 last:border-b-0 md:grid-cols-[1fr_120px_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">
                  {invite.email}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {invite.role} · expires {formatDate(invite.expiresAt)}
                </div>
              </div>
              <span className="w-fit rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
                pending
              </span>
              {canManageMembers && (() => {
                const inviteBusy =
                  busyKey === `resend:${invite.id}` ||
                  busyKey === `revoke:${invite.id}`
                return (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={inviteBusy}
                      onClick={() => void mutateInvite(invite.id, "resend")}
                      className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      {busyKey === `resend:${invite.id}` ? "Sending..." : "Resend"}
                    </button>
                    <button
                      type="button"
                      disabled={inviteBusy}
                      onClick={() => void mutateInvite(invite.id, "revoke")}
                      className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      {busyKey === `revoke:${invite.id}` ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
