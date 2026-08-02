"use client";
import useSWR from "swr";
import { useCallback, useMemo } from "react";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { fetchJsonObject } from "@/lib/client-fetch";
import { toast } from "@/hooks/use-toast";
import type { AIModel } from "@/lib/types";
import type { MutatorOptions } from "swr";

const fetcher = (url: string, activeTeamId: string | null) =>
  fetchJsonObject<ModelsResponse>(url, "Failed to load models", {
    headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
  });

type CatalogModel = AIModel & {
  is_enabled: boolean;
  is_hidden?: boolean | null;
};

type ModelsResponse = {
  models: AIModel[];
  catalog: CatalogModel[];
  default_model?: string | null;
};

type ModelsMutator = (
  data?:
    | ModelsResponse
    | ((current: ModelsResponse | undefined) => ModelsResponse | undefined),
  shouldRevalidate?: boolean | MutatorOptions<ModelsResponse>
) => Promise<ModelsResponse | undefined> | ModelsResponse | undefined;

type ModelsToast = typeof toast;
type ModelsFetch = typeof fetch;

const REVALIDATION_FAILURE_DESCRIPTION =
  "Please reload the page if the displayed state looks incorrect.";

export async function revalidateModelsWithFeedback(
  mutate: ModelsMutator,
  toastFn: ModelsToast,
  rollback: boolean,
  description = REVALIDATION_FAILURE_DESCRIPTION
) {
  try {
    await mutate();
    return true;
  } catch {
    toastFn({
      title: rollback
        ? "Model preference not saved"
        : "Could not refresh model list",
      description,
      variant: "destructive",
    });
    return false;
  }
}

function buildOptimisticModelsResponse(
  previous: ModelsResponse | undefined,
  modelId: string,
  isEnabled: boolean
) {
  if (!previous) return previous;
  const updatedCatalog = previous.catalog.map((model) =>
    model.id === modelId ? { ...model, is_enabled: isEnabled } : model
  );
  return {
    ...previous,
    catalog: updatedCatalog,
    models: updatedCatalog.filter(
      (model) => model.is_enabled && model.is_hidden !== true
    ),
  };
}

async function patchModelPreference(
  fetchFn: ModelsFetch,
  modelId: string,
  isEnabled: boolean,
  activeTeamId: string | null
) {
  const response = await fetchFn("/api/models", {
    method: "PATCH",
    headers: getActiveTeamRequestHeaders(
      {
        "Content-Type": "application/json",
      },
      activeTeamId
    ),
    body: JSON.stringify({ model_id: modelId, is_enabled: isEnabled }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update model preference (${response.status})`);
  }
}

function getModelPreferenceErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Failed to update model preference";
}

function getRollbackRevalidationErrorMessage(error: unknown) {
  return `${getModelPreferenceErrorMessage(error)} ${REVALIDATION_FAILURE_DESCRIPTION}`;
}

export async function toggleModelPreference({
  modelId,
  catalog,
  mutate,
  activeTeamId = null,
  fetchFn = fetch,
  toastFn = toast,
}: {
  modelId: string;
  catalog: CatalogModel[];
  mutate: ModelsMutator;
  activeTeamId?: string | null;
  fetchFn?: ModelsFetch;
  toastFn?: ModelsToast;
}) {
  const current = catalog.find((model) => model.id === modelId);
  if (current?.is_hidden === true) return;

  const newEnabled = !(current?.is_enabled ?? false);

  await mutate(
    (previous) => buildOptimisticModelsResponse(previous, modelId, newEnabled),
    false
  );

  try {
    await patchModelPreference(fetchFn, modelId, newEnabled, activeTeamId);
  } catch (error) {
    const rolledBack = await revalidateModelsWithFeedback(
      mutate,
      toastFn,
      true,
      getRollbackRevalidationErrorMessage(error)
    );
    if (rolledBack) {
      toastFn({
        title: "Model preference not saved",
        description: getModelPreferenceErrorMessage(error),
        variant: "destructive",
      });
    }
    return;
  }

  await revalidateModelsWithFeedback(mutate, toastFn, false);
}

export function useModels() {
  const activeTeamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<ModelsResponse>(
    ["/api/models", activeTeamId ?? "personal"],
    ([url, teamKey]) =>
      fetcher(url, teamKey === "personal" ? null : String(teamKey)),
    { revalidateOnFocus: false }
  );

  const models = data?.models ?? [];
  const catalog = useMemo(() => data?.catalog ?? [], [data?.catalog]);
  // Anonymous catalog responses already exclude hidden rows; authenticated
  // callers use this set for legacy-model badges on saved agents and flows.
  const hiddenModelIds = useMemo(
    () =>
      new Set(
        catalog
          .filter((model) => model.is_hidden === true)
          .map((model) => model.id)
      ),
    [catalog]
  );
  const modelIds = models.map((m) => m.id);
  const contextLimits = Object.fromEntries(
    models.filter((m) => m.context_length).map((m) => [m.id, m.context_length!])
  );

  const toggleModel = useCallback(
    (modelId: string) =>
      toggleModelPreference({
        modelId,
        catalog,
        mutate,
        activeTeamId,
      }),
    [activeTeamId, catalog, mutate]
  );

  return {
    models,
    catalog,
    defaultModelId: data?.default_model ?? null,
    hiddenModelIds,
    modelIds,
    contextLimits,
    isLoading,
    error,
    mutate,
    toggleModel,
  };
}
