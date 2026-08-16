"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GITHUB_ORG_READ_SCOPE,
  GITHUB_REAUTHORIZE_HEADER,
} from "@/lib/github-oauth";
import type { GithubRepoOwnerTarget } from "@/lib/github-owners";
import { validateGithubRepoName } from "@/lib/github-repo-name";
import type { AvailabilityState } from "./new-project-fields";

/** Remembers the account the user last created a project under. */
export const LAST_GITHUB_OWNER_KEY = "mogplex:last-github-repo-owner";
/** Debounce before asking GitHub whether owner/name is free, in ms. */
const AVAILABILITY_DEBOUNCE_MS = 350;

export type NewProjectAction = { href: string; label: string } | null;

/**
 * Loads the GitHub accounts a new project can be created under, and checks the
 * chosen owner/name pair for availability.
 *
 * Only runs while the composer actually targets a new project; `enabled` is
 * what parks it when an existing repo is selected.
 */
export function useNewProjectTarget({
  enabled,
  name,
}: {
  enabled: boolean;
  name: string;
}) {
  const [ownerTargets, setOwnerTargets] = useState<GithubRepoOwnerTarget[]>([]);
  const [ownerLogin, setOwnerLogin] = useState("");
  const [ownersLoading, setOwnersLoading] = useState(true);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [ownersAction, setOwnersAction] = useState<NewProjectAction>(null);
  const [availability, setAvailability] = useState<AvailabilityState>("idle");

  const nameValidation = useMemo(() => validateGithubRepoName(name), [name]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setOwnersLoading(true);
    setOwnersError(null);
    setOwnersAction(null);
    fetch("/api/github/owners", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("GitHub accounts unavailable");
        const data = (await response.json()) as unknown;
        return {
          targets: Array.isArray(data) ? (data as GithubRepoOwnerTarget[]) : [],
          reauthorizeScope: response.headers.get(GITHUB_REAUTHORIZE_HEADER),
        };
      })
      .then(({ targets, reauthorizeScope }) => {
        setOwnerTargets(targets);
        const saved = window.localStorage.getItem(LAST_GITHUB_OWNER_KEY);
        const preferred = targets.find(
          (target) => target.login.toLowerCase() === saved?.toLowerCase()
        );
        setOwnerLogin((current) =>
          targets.some(
            (target) => target.login.toLowerCase() === current.toLowerCase()
          )
            ? current
            : (preferred?.login ?? targets[0]?.login ?? "")
        );
        // /api/auth/github is the signed-in connect route. The signup route
        // (/api/auth/login/github) sits behind the legacy access-code gate and
        // bounces an existing account to /login/beta?error=waitlist_required.
        // `reauthorize=1` forces the OAuth grant even where the GitHub App is
        // configured, since only that grant can add the missing read:org scope.
        const next = `${window.location.pathname}${window.location.search}`;
        const connectHref = `/api/auth/github?next=${encodeURIComponent(next)}`;
        if (targets.length === 0) {
          setOwnersError("GitHub must be connected to create a project.");
          setOwnersAction({ href: connectHref, label: "Connect GitHub" });
        } else if (reauthorizeScope === GITHUB_ORG_READ_SCOPE) {
          setOwnersError("Reconnect GitHub to use organization accounts.");
          setOwnersAction({
            href: `${connectHref}&reauthorize=1`,
            label: "Reconnect GitHub",
          });
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setOwnerTargets([]);
        setOwnerLogin("");
        setOwnersError("GitHub accounts unavailable.");
        setOwnersAction(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOwnersLoading(false);
      });

    return () => controller.abort();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !ownerLogin) {
      setAvailability("idle");
      return;
    }
    if (!nameValidation.ok) {
      setAvailability("invalid");
      return;
    }

    const controller = new AbortController();
    setAvailability("checking");
    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams({
        owner: ownerLogin,
        name: nameValidation.name,
      });
      fetch(`/api/github/repos/availability?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as {
            availability?: AvailabilityState;
          };
          if (!response.ok) {
            return "unverified";
          }
          return data.availability ?? "unverified";
        })
        .then((state) => {
          if (!controller.signal.aborted) setAvailability(state);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setAvailability("unverified");
        });
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [enabled, nameValidation, ownerLogin]);

  return {
    ownerTargets,
    ownerLogin,
    setOwnerLogin,
    ownersLoading,
    ownersError,
    ownersAction,
    availability,
    nameValidation,
  };
}
