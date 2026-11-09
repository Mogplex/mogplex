"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchJsonArray } from "@/lib/client-fetch";
import {
  latestRepoSync,
  type RepoAutomation,
} from "@/lib/settings/owner-automations";

export type RepositoryInstallation = {
  installation_id: number;
  account_login?: string | null;
  account_type?: string | null;
  manage_url?: string | null;
  repos_synced_at?: string | null;
};

const fetchInstallations = (url: string) =>
  fetchJsonArray<RepositoryInstallation>(url, "Failed to load installations");
const fetchAutomations = (url: string) =>
  fetchJsonArray<RepoAutomation>(url, "Failed to load automations");

/**
 * What Settings → Repositories shows around the list: each installation's
 * GitHub access link and account type, the automations that can run on
 * repositories, and when repositories were last synced. Either request may
 * fail; the list still renders without these extras.
 */
export function useRepositoryContext() {
  const { data: installations, mutate: refreshInstallations } = useSWR(
    "/api/github/installations",
    fetchInstallations
  );
  const { data: automations } = useSWR(
    "/api/flows?view=triggers",
    fetchAutomations
  );

  return useMemo(
    () => ({
      installationsById: new Map(
        (installations ?? []).map((installation) => [
          Number(installation.installation_id),
          installation,
        ])
      ),
      automations: automations ?? [],
      installedOwners: (installations ?? []).flatMap((installation) =>
        installation.account_login ? [installation.account_login] : []
      ),
      lastSyncedAt: latestRepoSync(installations ?? []),
      refreshInstallations,
    }),
    [installations, automations, refreshInstallations]
  );
}
