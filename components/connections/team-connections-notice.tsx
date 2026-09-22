"use client";

import Link from "next/link";
import { useMemberships } from "@/hooks/use-memberships";
import { scopedHref } from "@/lib/scoped-href";

export function TeamConnectionsNotice() {
  const { memberships } = useMemberships();
  const personalSlug = memberships.personal.slug;
  return (
    <section className="space-y-3 border border-border/60 bg-card p-5">
      <h2 className="ui-section-title">Personal connections</h2>
      <p className="max-w-[65ch] text-sm text-muted-foreground">
        Connections belong to your personal account. Shared team connections
        are not available yet.
      </p>
      {personalSlug && (
        <Link
          href={scopedHref(personalSlug, "/connections")}
          className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open personal connections
        </Link>
      )}
    </section>
  );
}
