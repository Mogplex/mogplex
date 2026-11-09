"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { fetchJsonArray } from "@/lib/client-fetch";
import {
  githubAutomations,
  latestRepoSync,
} from "@/lib/settings/owner-automations";
import type { Flow } from "@/lib/types";

export type RepositoryInstallation = {
  installation_id: number;
  account_type?: string | null;
  manage_url?: string | null;
  repos_synced_at?: string | null;
};

const fetchInstallations = (url: string) =>
  fetchJsonArray<RepositoryInstallation>(url, "Failed to load installations");
const fetchFlows = (url: string) =>
  fetchJsonArray<Flow>(url, "Failed to load automations");

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
  const { data: flows } = useSWR("/api/flows", fetchFlows);

  return useMemo(
    () => ({
      installationsById: new Map(
        (installations ?? []).map((installation) => [
          Number(installation.installation_id),
          installation,
        ])
      ),
      automations: githubAutomations(flows ?? []),
      lastSyncedAt: latestRepoSync(installations ?? []),
      refreshInstallations,
    }),
    [installations, flows, refreshInstallations]
  );
}
