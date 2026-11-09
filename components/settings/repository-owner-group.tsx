"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { OpenNewWindow } from "iconoir-react";

const noun = (count: number) => (count === 1 ? "repository" : "repositories");

/**
 * One GitHub owner's repositories, headed the way GitHub shows an account or
 * organization: avatar, login linking to its GitHub page, and a count. The
 * header also names the automations that can run on these repositories and
 * links to the GitHub App's access settings for this owner.
 */
export function RepositoryOwnerGroup({
  owner,
  count,
  manageUrl,
  automations,
  automationsHref,
  children,
}: {
  owner: string;
  count: number;
  manageUrl?: string | null;
  automations: Array<{ id: string; name: string }>;
  automationsHref: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={owner} className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        <img
          src={`https://github.com/${encodeURIComponent(owner)}.png?size=40`}
          alt=""
          className="bg-accent size-5 shrink-0 rounded-sm"
        />
        <h2 className="text-foreground text-sm font-medium">
          <a
            href={`https://github.com/${encodeURIComponent(owner)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {owner}
          </a>
        </h2>
        <span className="text-muted-foreground text-xs">
          {count} {noun(count)}
        </span>
        {automations.length > 0 ? (
          <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
            <span>· Runs</span>
            {automations.map((automation) => (
              <Link
                key={automation.id}
                href={automationsHref}
                className="border-border text-foreground/80 hover:bg-secondary rounded-full border px-2 py-0.5 text-[11px]"
              >
                {automation.name}
              </Link>
            ))}
          </span>
        ) : null}
        {manageUrl ? (
          <a
            href={manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Manage ${owner} repository access on GitHub`}
            className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs"
          >
            Manage access on GitHub
            <OpenNewWindow aria-hidden="true" className="size-3" />
          </a>
        ) : null}
      </div>
      <ul
        aria-label={`${owner} repositories`}
        className="border-border rounded-md border"
      >
        {children}
      </ul>
    </section>
  );
}
