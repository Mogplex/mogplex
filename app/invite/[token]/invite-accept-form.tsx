"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AcceptInviteResponse } from "@/app/api/invites/[token]/route";

type Props = {
  token: string;
  emailMatch: boolean;
  inviteEmail: string;
  currentEmail: string;
};

export function InviteAcceptForm({
  token,
  emailMatch,
  inviteEmail,
  currentEmail,
}: Props) {
  const router = useRouter();
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmMismatch }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | AcceptInviteResponse
        | { error?: string };
      if (!res.ok || !("team" in data)) {
        const code = "error" in data ? data.error : undefined;
        setError(
          code === "expired"
            ? "This invitation has expired."
            : code === "already_accepted"
              ? "This invitation has already been accepted."
              : code === "mismatch_unconfirmed"
                ? "Please confirm you want to join with a different email."
                : code || "Failed to accept invitation"
        );
        setSubmitting(false);
        return;
      }
      router.push(`/${data.team.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept");
      setSubmitting(false);
    }
  };

  const canAccept = emailMatch || confirmMismatch;

  return (
    <div className="mt-6 space-y-4">
      {!emailMatch && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground">
          <p>
            This invitation was sent to{" "}
            <strong>{inviteEmail}</strong>, but you&apos;re signed in as{" "}
            <strong>{currentEmail}</strong>.
          </p>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={confirmMismatch}
              onChange={(e) => setConfirmMismatch(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I want to join with my current account ({currentEmail}) instead.
            </span>
          </label>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleAccept}
        disabled={submitting || !canAccept}
        className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
      >
        {submitting ? "Joining…" : "Accept invitation"}
      </button>
    </div>
  );
}
