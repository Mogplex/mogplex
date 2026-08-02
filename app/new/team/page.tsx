"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/use-user";
import { useMemberships } from "@/hooks/use-memberships";
import { toast } from "@/hooks/use-toast";
import { isValidScopeSlug, slugifyTeamName } from "@/lib/team-slug";
import type { SlugCheckResponse } from "@/app/api/teams/slug-check/route";
import type { CreateTeamResponse } from "@/app/api/teams/route";
import type {
  BulkInviteResponse,
  BulkInviteRole,
} from "@/app/api/teams/[teamId]/invites/bulk/route";
import { MAX_BULK_INVITE_EMAILS } from "@/lib/team-bulk-invite";
import type { OrgMembersResponse } from "@/app/api/github/installations/[installationId]/org-members/route";

type SlugStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: SlugCheckResponse["reason"] };

type Installation = {
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
  scope_label: string;
};

type SubmitProgress = "idle" | "creating" | "attaching" | "inviting";

function isOrgInstallation(installation: Installation | undefined | null) {
  const raw = (installation?.target_type || installation?.account_type || "").toLowerCase();
  return raw.includes("org");
}

export default function NewTeamPage() {
  const router = useRouter();
  const { mutate: mutateMemberships } = useMemberships();
  const { isLoading: userLoading, user } = useUser();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>({ state: "idle" });
  const [progress, setProgress] = useState<SubmitProgress>("idle");
  const [error, setError] = useState<string | null>(null);
  const checkSeqRef = useRef(0);
  const orgMembersRequestRef = useRef(0);

  const [installations, setInstallations] = useState<Installation[] | null>(
    null
  );
  const [installationsError, setInstallationsError] = useState<string | null>(
    null
  );
  const [selectedInstallationId, setSelectedInstallationId] = useState<
    number | null
  >(null);
  const [attachInstallation, setAttachInstallation] = useState(true);

  const [bulkInvite, setBulkInvite] = useState(false);
  const [bulkInviteRole, setBulkInviteRole] = useState<BulkInviteRole>(
    "developer"
  );
  const [orgMembers, setOrgMembers] = useState<OrgMembersResponse | null>(null);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);
  const [orgMembersError, setOrgMembersError] = useState<string | null>(null);

  const selectedInstallation = useMemo(
    () =>
      installations?.find(
        (i) => i.installation_id === selectedInstallationId
      ) ?? null,
    [installations, selectedInstallationId]
  );
  const selectedIsOrg = isOrgInstallation(selectedInstallation);

  useEffect(() => {
    if (!slugDirty) {
      setSlug(slugifyTeamName(name));
    }
  }, [name, slugDirty]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/github/installations");
        if (!res.ok) throw new Error(`installations ${res.status}`);
        const data = (await res.json()) as Installation[];
        if (cancelled) return;
        setInstallations(data ?? []);
        const firstOrg = data?.find((i) => isOrgInstallation(i));
        const first = firstOrg ?? data?.[0] ?? null;
        if (first) setSelectedInstallationId(first.installation_id);
      } catch (err) {
        if (cancelled) return;
        setInstallationsError(
          err instanceof Error ? err.message : "Failed to load installations"
        );
        setInstallations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Any in-flight preview belongs to the previous installation — invalidate
    // it so a late response doesn't overwrite state for the new selection.
    // Also clear `orgMembersLoading`: the discarded request's `finally` will
    // skip the reset because its sequence is now stale, so without this the
    // spinner (and disabled submit) would get stuck.
    orgMembersRequestRef.current += 1;
    setOrgMembers(null);
    setOrgMembersError(null);
    setOrgMembersLoading(false);
  }, [selectedInstallationId]);

  // When the attach toggle is turned off, clear the bulk-invite intent and any
  // cached preview so a stale orgMembers list from a previous selection can't
  // be submitted via the (now hidden) controls.
  // Toggling only bulk-invite off/on intentionally keeps the preview cached so
  // the user does not have to re-preview the same selected org.
  useEffect(() => {
    if (!attachInstallation || !selectedIsOrg) {
      setBulkInvite(false);
      setOrgMembers(null);
      setOrgMembersError(null);
      orgMembersRequestRef.current += 1;
      setOrgMembersLoading(false);
    }
  }, [attachInstallation, selectedIsOrg]);

  useEffect(() => {
    if (!slug) {
      setSlugStatus({ state: "idle" });
      return;
    }
    if (!isValidScopeSlug(slug)) {
      setSlugStatus({ state: "unavailable", reason: "invalid" });
      return;
    }
    setSlugStatus({ state: "checking" });
    const seq = ++checkSeqRef.current;
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/teams/slug-check?slug=${encodeURIComponent(slug)}`
        );
        if (!res.ok) throw new Error("Slug check failed");
        const data = (await res.json()) as SlugCheckResponse;
        if (seq !== checkSeqRef.current) return;
        setSlugStatus(
          data.available
            ? { state: "available" }
            : { state: "unavailable", reason: data.reason }
        );
      } catch {
        if (seq !== checkSeqRef.current) return;
        setSlugStatus({ state: "idle" });
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [slug]);

  const loadOrgMembers = async () => {
    if (!selectedInstallationId) return;
    const requestedInstallationId = selectedInstallationId;
    const seq = ++orgMembersRequestRef.current;
    setOrgMembersLoading(true);
    setOrgMembersError(null);
    try {
      const res = await fetch(
        `/api/github/installations/${requestedInstallationId}/org-members`
      );
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(detail?.error || `org-members ${res.status}`);
      }
      const data = (await res.json()) as OrgMembersResponse;
      // Discard stale responses: if the user switched installations while this
      // request was in flight, applying it would attach one installation while
      // inviting another installation's members.
      if (seq !== orgMembersRequestRef.current) return;
      setOrgMembers(data);
    } catch (err) {
      if (seq !== orgMembersRequestRef.current) return;
      setOrgMembersError(
        err instanceof Error ? err.message : "Failed to load org members"
      );
    } finally {
      if (seq === orgMembersRequestRef.current) {
        setOrgMembersLoading(false);
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Team name is required");
      return;
    }
    if (!isValidScopeSlug(slug)) {
      setError("Pick a valid slug (a-z, 0-9, hyphens, 1-39 chars).");
      return;
    }
    if (slugStatus.state === "unavailable") {
      setError("That slug isn't available.");
      return;
    }

    setProgress("creating");
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug }),
      });
      const data = (await res.json()) as
        | CreateTeamResponse
        | { error: string };
      if (!res.ok || !("team" in data)) {
        setError(
          "error" in data && data.error ? data.error : "Failed to create team"
        );
        setProgress("idle");
        return;
      }
      const team = data.team;

      if (attachInstallation && selectedInstallationId) {
        setProgress("attaching");
        try {
          const attachRes = await fetch(
            `/api/teams/${team.id}/installations`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                installation_id: selectedInstallationId,
              }),
            }
          );
          if (!attachRes.ok) {
            const detail = (await attachRes.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(detail?.error || `attach ${attachRes.status}`);
          }
        } catch (err) {
          toast({
            title: "Installation not attached",
            description:
              err instanceof Error
                ? err.message
                : "You can attach it later from Settings.",
            variant: "destructive",
          });
        }
      }

      if (
        bulkInvite &&
        attachInstallation &&
        selectedIsOrg &&
        selectedInstallationId &&
        orgMembers
      ) {
        const allEmails = orgMembers.members
          .filter((m): m is { login: string; email: string } => Boolean(m.email))
          .map((m) => m.email);
        // Enforce the server-side per-request cap on the client too: this flow
        // is intentionally one-time, not unbounded chunked.
        const truncatedCount = Math.max(
          0,
          allEmails.length - MAX_BULK_INVITE_EMAILS
        );
        const emails = allEmails.slice(0, MAX_BULK_INVITE_EMAILS);
        if (emails.length > 0) {
          setProgress("inviting");
          try {
            const inviteRes = await fetch(
              `/api/teams/${team.id}/invites/bulk`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  emails,
                  role: bulkInviteRole,
                }),
              }
            );
            const inviteData = (await inviteRes.json()) as
              | BulkInviteResponse
              | { error: string };
            if (!inviteRes.ok || !("summary" in inviteData)) {
              throw new Error(
                "error" in inviteData
                  ? inviteData.error
                  : `bulk ${inviteRes.status}`
              );
            }
            const s = inviteData.summary;
            const parts = [`Sent ${s.invited} invites`];
            if (s.skipped_member > 0) parts.push(`${s.skipped_member} already members`);
            if (s.delivery_failed > 0) parts.push(`${s.delivery_failed} delivery failed`);
            if (truncatedCount > 0) {
              parts.push(
                `${truncatedCount} skipped (cap ${MAX_BULK_INVITE_EMAILS})`
              );
            }
            toast({
              title: "Invites sent",
              description: parts.join(" · "),
            });
          } catch (err) {
            toast({
              title: "Some invites failed",
              description:
                err instanceof Error
                  ? err.message
                  : "Check Settings → Teams for status.",
              variant: "destructive",
            });
          }
        }
      }

      await mutateMemberships();
      router.push(`/${team.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
      setProgress("idle");
    }
  };

  const slugHelp = (() => {
    if (slugStatus.state === "checking") return "Checking availability…";
    if (slugStatus.state === "available") return "Slug is available";
    if (slugStatus.state === "unavailable") {
      if (slugStatus.reason === "reserved") return "Slug is reserved";
      if (slugStatus.reason === "taken") return "Slug is already taken";
      return "Slug must be 1-39 chars, [a-z0-9-], no leading/trailing/double hyphens";
    }
    return "Used in URLs like mogplex.com/your-slug";
  })();

  const submitting = progress !== "idle";
  const bulkInviteActive =
    bulkInvite && attachInstallation && selectedIsOrg && !!selectedInstallationId;
  const bulkInviteNeedsPreview = bulkInviteActive && !orgMembers;
  const submitLabel = (() => {
    if (progress === "creating") return "Creating team…";
    if (progress === "attaching") return "Attaching installation…";
    if (progress === "inviting") return "Sending invites…";
    return "Create team";
  })();

  const orgMembersWithEmail = orgMembers
    ? orgMembers.members.filter((m) => m.email).length
    : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            ← Back
          </Link>
          {userLoading ? null : user?.username ? (
            <span>{user.email}</span>
          ) : null}
        </div>
        <h1 className="text-2xl font-medium text-foreground">Create a team</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Teams share provider keys, projects, and agent rosters.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="team-name"
              className="block text-xs font-medium text-foreground"
            >
              Team name
            </label>
            <input
              id="team-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Acme Inc"
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="team-slug"
              className="block text-xs font-medium text-foreground"
            >
              URL slug
            </label>
            <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
              <span className="text-xs text-muted-foreground">mogplex.com/</span>
              <input
                id="team-slug"
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugDirty(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                maxLength={39}
                required
                className="flex-1 bg-transparent py-2 text-sm outline-none"
                placeholder="acme"
              />
            </div>
            <p
              className={`mt-1 text-xs ${
                slugStatus.state === "unavailable"
                  ? "text-destructive"
                  : slugStatus.state === "available"
                    ? "text-emerald-500"
                    : "text-muted-foreground"
              }`}
            >
              {slugHelp}
            </p>
          </div>

          {installations !== null && installations.length > 0 && (
            <div className="space-y-3 rounded-md border border-border bg-card/40 p-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={attachInstallation}
                  onChange={(e) => setAttachInstallation(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-xs font-medium text-foreground">
                    Attach a GitHub installation
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
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
                    setSelectedInstallationId(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {installations.map((inst) => (
                    <option
                      key={inst.installation_id}
                      value={String(inst.installation_id)}
                    >
                      {inst.account_login ?? `Installation ${inst.installation_id}`}{" "}
                      ({inst.scope_label || inst.target_type || "Account"})
                    </option>
                  ))}
                </select>
              )}

              {attachInstallation && selectedIsOrg && (
                <div className="space-y-2 border-t border-border pt-3">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={bulkInvite}
                      onChange={(e) => setBulkInvite(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-xs font-medium text-foreground">
                        Send invites to org members
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        One-time. We will not keep this in sync with GitHub.
                      </span>
                    </span>
                  </label>

                  {bulkInvite && (
                    <div className="space-y-2 pl-6">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          Invite as:
                        </span>
                        <select
                          value={bulkInviteRole}
                          onChange={(e) =>
                            setBulkInviteRole(e.target.value as BulkInviteRole)
                          }
                          className="rounded-md border border-border bg-card px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="developer">Developer</option>
                          <option value="viewer">Viewer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={loadOrgMembers}
                        disabled={orgMembersLoading}
                        className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
                      >
                        {orgMembersLoading
                          ? "Loading members…"
                          : orgMembers
                            ? "Refresh members"
                            : "Preview members"}
                      </button>

                      {orgMembersError && (
                        <p className="text-[11px] text-destructive">
                          {orgMembersError}
                        </p>
                      )}

                      {bulkInviteNeedsPreview && !orgMembersError && !orgMembersLoading && (
                        <p className="text-[11px] text-amber-500">
                          Preview members before creating the team so invites can be sent.
                        </p>
                      )}

                      {orgMembers && orgMembersWithEmail !== null && (
                        <p className="text-[11px] text-muted-foreground">
                          {orgMembersWithEmail} member
                          {orgMembersWithEmail === 1 ? "" : "s"} with a public email
                          {orgMembers.no_email_count > 0 ? (
                            <>
                              {" · "}
                              <span className="text-amber-500">
                                {orgMembers.no_email_count} have no public email
                                (invite manually)
                              </span>
                            </>
                          ) : null}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {installationsError && (
            <p className="text-[11px] text-muted-foreground">
              Could not load GitHub installations ({installationsError}). You can
              attach one later from Settings.
            </p>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              slugStatus.state === "checking" ||
              slugStatus.state === "unavailable" ||
              bulkInviteNeedsPreview
            }
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </form>
      </div>
    </main>
  );
}
