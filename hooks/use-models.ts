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
  surface_models?: Partial<
    Record<"chat" | "control" | "agents", string | null>
  >;
};

type ModelsMutator = (
  data?:
    | ModelsResponse
    | ((current: ModelsResponse | undefined) => ModelsResponse | undefined),
  shouldRevalidate?: boolean | MutatorOptions<ModelsResponse>
) => Promise<ModelsResponse | undefined> | ModelsResponse | undefined;

// Only the base call is used, so injectable fakes need not implement the
// status helpers (`toast.success`, `toast.error`, ...).
type ModelsToast = (
  props: Parameters<typeof toast>[0]
) => ReturnType<typeof toast>;
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

type PreferenceQueue = {
  latest: number;
  /** The value of the newest click, re-applied if an older refresh lands. */
  desired: boolean;
  tail: Promise<unknown>;
};

/**
 * One chain of saves per team and model. Each step saves and then refreshes
 * before the next starts, so a refresh never races a newer click's save.
 */
const preferenceQueues = new Map<string, PreferenceQueue>();

/**
 * Set a model's enabled state to `enabled`, the value the user just chose.
 * A save that a newer click replaced before it started is skipped; only the
 * newest click rolls back or warns on failure.
 */
export async function toggleModelPreference({
  modelId,
  enabled,
  catalog,
  mutate,
  activeTeamId = null,
  fetchFn = fetch,
  toastFn = toast,
}: {
  modelId: string;
  enabled: boolean;
  catalog: CatalogModel[];
  mutate: ModelsMutator;
  activeTeamId?: string | null;
  fetchFn?: ModelsFetch;
  toastFn?: ModelsToast;
}) {
  const current = catalog.find((model) => model.id === modelId);
  if (current?.is_hidden === true) return;

  const applyOptimistic = (value: boolean) =>
    mutate(
      (previous) => buildOptimisticModelsResponse(previous, modelId, value),
      false
    );
  await applyOptimistic(enabled);

  const key = `${activeTeamId ?? "personal"}:${modelId}`;
  const queue = preferenceQueues.get(key) ?? {
    latest: 0,
    desired: enabled,
    tail: Promise.resolve(),
  };
  preferenceQueues.set(key, queue);
  const generation = ++queue.latest;
  queue.desired = enabled;
  const isNewest = () => generation === queue.latest;

  const step = queue.tail.then(async () => {
    if (!isNewest()) return;
    try {
      await patchModelPreference(fetchFn, modelId, enabled, activeTeamId);
    } catch (error) {
      if (!isNewest()) return;
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
      if (!isNewest()) await applyOptimistic(queue.desired);
      return;
    }
    await revalidateModelsWithFeedback(mutate, toastFn, false);
    // A click during the refresh keeps showing its value until its own save.
    if (!isNewest()) await applyOptimistic(queue.desired);
  });
  queue.tail = step.catch(() => undefined);
  await queue.tail;
  if (isNewest() && preferenceQueues.get(key) === queue) {
    preferenceQueues.delete(key);
  }
}

export function useModels(
  surface: "chat" | "control" | "agents" | "automations" = "chat"
) {
  const activeTeamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<ModelsResponse>(
    ["/api/models", activeTeamId ?? "personal"],
    ([url, teamKey]) =>
      fetcher(url, teamKey === "personal" ? null : String(teamKey)),
    { revalidateOnFocus: false, refreshInterval: 0 }
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
    (modelId: string, enabled: boolean) =>
      toggleModelPreference({
        modelId,
        enabled,
        catalog,
        mutate,
        activeTeamId,
      }),
    [activeTeamId, catalog, mutate]
  );

  return {
    models,
    catalog,
    defaultModelId:
      (surface === "automations" ? null : data?.surface_models?.[surface]) ??
      data?.default_model ??
      null,
    hiddenModelIds,
    modelIds,
    contextLimits,
    isLoading,
    error,
    mutate,
    toggleModel,
  };
}
