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

import type {
  Installation,
  SlugStatus,
  SubmitProgress,
  OrgMembersResponse,
} from "./types";
import { isOrgInstallation, getSlugHelp, getSubmitLabel } from "./helpers";
import { InstallationSection } from "./_components/installation-section";

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
  const [bulkInviteRole, setBulkInviteRole] =
    useState<BulkInviteRole>("developer");
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
    orgMembersRequestRef.current += 1;
    setOrgMembers(null);
    setOrgMembersError(null);
    setOrgMembersLoading(false);
  }, [selectedInstallationId]);

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
        const detail = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(detail?.error || `org-members ${res.status}`);
      }
      const data = (await res.json()) as OrgMembersResponse;
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
      const data = (await res.json()) as CreateTeamResponse | { error: string };
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
          const attachRes = await fetch(`/api/teams/${team.id}/installations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              installation_id: selectedInstallationId,
            }),
          });
          if (!attachRes.ok) {
            const detail = (await attachRes.json().catch(() => null)) as {
              error?: string;
            } | null;
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
          .filter((m): m is { login: string; email: string } =>
            Boolean(m.email)
          )
          .map((m) => m.email);
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
            if (s.skipped_member > 0)
              parts.push(`${s.skipped_member} already members`);
            if (s.delivery_failed > 0)
              parts.push(`${s.delivery_failed} delivery failed`);
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
                  : "Check Settings -> Teams for status.",
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

  const slugHelp = getSlugHelp(slugStatus);
  const submitting = progress !== "idle";
  const bulkInviteActive =
    bulkInvite &&
    attachInstallation &&
    selectedIsOrg &&
    !!selectedInstallationId;
  const bulkInviteNeedsPreview = bulkInviteActive && !orgMembers;
  const submitLabel = getSubmitLabel(progress);

  return (
    <main className="bg-background flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-muted-foreground mb-6 flex items-center justify-between text-xs">
          <Link href="/" className="hover:text-foreground">
            ← Back
          </Link>
          {userLoading ? null : user?.username ? (
            <span>{user.email}</span>
          ) : null}
        </div>
        <h1 className="text-foreground text-2xl font-medium">Create a team</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Teams share provider keys, projects, and agent rosters.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="team-name"
              className="text-foreground block text-xs font-medium"
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
              className="border-border bg-card focus-visible:ring-ring mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              placeholder="Acme Inc"
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="team-slug"
              className="text-foreground block text-xs font-medium"
            >
              URL slug
            </label>
            <div className="border-border bg-card focus-within:ring-ring mt-1 flex items-center gap-1 rounded-md border px-3 focus-within:ring-2">
              <span className="text-muted-foreground text-xs">
                mogplex.com/
              </span>
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
            <InstallationSection
              installations={installations}
              attachInstallation={attachInstallation}
              onAttachInstallationChange={setAttachInstallation}
              selectedInstallationId={selectedInstallationId}
              onSelectedInstallationIdChange={setSelectedInstallationId}
              selectedIsOrg={selectedIsOrg}
              bulkInvite={bulkInvite}
              onBulkInviteChange={setBulkInvite}
              bulkInviteRole={bulkInviteRole}
              onBulkInviteRoleChange={setBulkInviteRole}
              orgMembers={orgMembers}
              orgMembersLoading={orgMembersLoading}
              orgMembersError={orgMembersError}
              onLoadOrgMembers={loadOrgMembers}
              bulkInviteNeedsPreview={bulkInviteNeedsPreview}
            />
          )}

          {installationsError && (
            <p className="text-muted-foreground text-[11px]">
              Could not load GitHub installations ({installationsError}). You
              can attach one later from Settings.
            </p>
          )}

          {error && (
            <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
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
            className="bg-foreground text-background hover:bg-foreground/90 w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </form>
      </div>
    </main>
  );
}
