import { useEffect, useMemo, useState } from "react";
import type { Flow } from "@/lib/types";
import type { Installation } from "./types";
import { installationAccountLabel } from "./start-filter-fields";
import { getStartConfig } from "@/lib/flows/graph";

export type FlowCreateBrowseState = {
  // Create state
  createInstallationId: string;
  setCreateInstallationId: (id: string) => void;
  createRepository: string;
  setCreateRepository: (repo: string) => void;
  createRepositoryOptions: Array<{ id: string; full_name: string }>;
  isCreating: boolean;
  setIsCreating: (creating: boolean) => void;
  // Browse state
  browseInstallationId: string;
  setBrowseInstallationId: (id: string) => void;
  browseRepositories: string[];
  setBrowseRepositories: React.Dispatch<React.SetStateAction<string[]>>;
  browseRepositoryOptions: Array<{
    id: string;
    full_name: string;
    installationId: number;
  }>;
  browseAccountLabel: string;
  // Search
  flowSearch: string;
  setFlowSearch: (search: string) => void;
  // Computed
  visibleFlows: Flow[];
};

export type FlowCreateBrowseStateParams = {
  installations: Installation[] | undefined;
  flows: Flow[] | undefined;
};

/**
 * Manages state for creating new flows and browsing/filtering existing flows.
 * Handles installation/repository selection and computes visible flows.
 */
export function useFlowCreateBrowseState({
  installations,
  flows,
}: FlowCreateBrowseStateParams): FlowCreateBrowseState {
  const [createInstallationId, setCreateInstallationId] = useState("");
  const [createRepository, setCreateRepository] = useState("all");
  const [browseInstallationId, setBrowseInstallationId] = useState("all");
  const [browseRepositories, setBrowseRepositories] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [flowSearch, setFlowSearch] = useState("");

  const browseRepositoryOptions = useMemo(() => {
    const candidates = (installations || []).filter(
      (installation) =>
        browseInstallationId === "all" ||
        String(installation.installation_id) === browseInstallationId
    );
    return candidates
      .flatMap((installation) =>
        installation.repositories.map((repository) => ({
          ...repository,
          installationId: installation.installation_id,
        }))
      )
      .sort((left, right) => left.full_name.localeCompare(right.full_name));
  }, [browseInstallationId, installations]);

  const browseAccountLabel = useMemo(() => {
    if (browseInstallationId === "all") return "all connected accounts";
    const installation = (installations || []).find(
      (candidate) => String(candidate.installation_id) === browseInstallationId
    );
    return installation
      ? installationAccountLabel(installation)
      : "this account";
  }, [browseInstallationId, installations]);

  const createRepositoryOptions = useMemo(() => {
    const installation = (installations || []).find(
      (candidate) => String(candidate.installation_id) === createInstallationId
    );
    return [...(installation?.repositories ?? [])].sort((left, right) =>
      left.full_name.localeCompare(right.full_name)
    );
  }, [createInstallationId, installations]);

  // Reset create repository if no longer available in the selected installation
  useEffect(() => {
    if (
      createRepository !== "all" &&
      !createRepositoryOptions.some(
        (repository) => repository.full_name === createRepository
      )
    ) {
      setCreateRepository("all");
    }
  }, [createRepository, createRepositoryOptions]);

  const visibleFlows = useMemo(() => {
    const selectedRepositoryKeys = new Set(
      browseRepositories.map((repository) => repository.toLowerCase())
    );
    const selectedRepositories = browseRepositoryOptions.filter((repository) =>
      selectedRepositoryKeys.has(repository.full_name.toLowerCase())
    );

    return (flows || []).filter((flow) => {
      if (
        browseInstallationId !== "all" &&
        String(flow.installation_id) !== browseInstallationId
      ) {
        return false;
      }
      if (selectedRepositories.length === 0) return true;
      const selectedForInstallation = selectedRepositories.filter(
        (repository) => repository.installationId === flow.installation_id
      );
      if (selectedForInstallation.length === 0) return false;
      const scopedRepos = getStartConfig(flow.draft_graph)?.filter?.repos ?? [];
      if (scopedRepos.length === 0) return true;
      const scopedRepositoryKeys = new Set(
        scopedRepos.map((repository) => repository.toLowerCase())
      );
      return selectedForInstallation.some((repository) =>
        scopedRepositoryKeys.has(repository.full_name.toLowerCase())
      );
    });
  }, [
    browseInstallationId,
    browseRepositories,
    browseRepositoryOptions,
    flows,
  ]);

  // Filter out browse repositories that no longer exist in available options
  useEffect(() => {
    const available = new Set(
      browseRepositoryOptions.map((repository) => repository.full_name)
    );
    setBrowseRepositories((current) => {
      const next = current.filter((repository) => available.has(repository));
      return next.length === current.length ? current : next;
    });
  }, [browseRepositoryOptions]);

  // Default to first installation when none selected
  useEffect(() => {
    if (!createInstallationId && installations && installations.length > 0) {
      setCreateInstallationId(String(installations[0].installation_id));
    }
  }, [createInstallationId, installations]);

  return {
    createInstallationId,
    setCreateInstallationId,
    createRepository,
    setCreateRepository,
    createRepositoryOptions,
    isCreating,
    setIsCreating,
    browseInstallationId,
    setBrowseInstallationId,
    browseRepositories,
    setBrowseRepositories,
    browseRepositoryOptions,
    browseAccountLabel,
    flowSearch,
    setFlowSearch,
    visibleFlows,
  };
}
