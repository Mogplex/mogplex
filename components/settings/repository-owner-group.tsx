"use client";

import type { ReactNode } from "react";

const noun = (count: number) => (count === 1 ? "repository" : "repositories");

/**
 * One GitHub owner's repositories, headed the way GitHub shows an account or
 * organization: avatar, login linking to its GitHub page, and a count.
 */
export function RepositoryOwnerGroup({
  owner,
  count,
  children,
}: {
  owner: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={owner} className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
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
