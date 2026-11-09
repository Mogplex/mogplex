import type { toggleModelPreference } from "../../hooks/use-models";
import type { AIModel } from "../../lib/types";

export type ToggleOptions = Parameters<typeof toggleModelPreference>[0];
export type CatalogModel = ToggleOptions["catalog"][number];
type MutateOptions = Parameters<ToggleOptions["mutate"]>[1];
type ModelsResponse = {
  models: AIModel[];
  catalog: CatalogModel[];
};

export function buildCatalogModel(
  overrides: Partial<CatalogModel> = {}
): CatalogModel {
  return {
    id: "provider/model-a",
    provider: "provider",
    name: "Model A",
    context_length: 128_000,
    capabilities: ["text"],
    is_available: true,
    is_enabled: false,
    is_hidden: false,
    ...overrides,
  };
}

export function createHarness({
  model = buildCatalogModel(),
  revalidateFails = false,
}: {
  model?: CatalogModel;
  revalidateFails?: boolean;
} = {}) {
  const serverData: ModelsResponse = {
    catalog: [{ ...model }],
    models: model.is_enabled ? [{ ...model }] : [],
  };
  let data: ModelsResponse = {
    catalog: [{ ...model }],
    models: model.is_enabled ? [{ ...model }] : [],
  };
  const mutateCalls: Array<{
    update: unknown;
    shouldRevalidate: MutateOptions;
  }> = [];
  const toastCalls: Array<{
    title?: unknown;
    description?: unknown;
    variant?: unknown;
  }> = [];

  const mutate: ToggleOptions["mutate"] = async (update, shouldRevalidate) => {
    mutateCalls.push({ update, shouldRevalidate });
    if (typeof update === "function") {
      data = update(data) ?? data;
      return data;
    }
    if (update) {
      data = update;
      return data;
    }
    if (revalidateFails) {
      throw new Error("revalidate failed");
    }
    data = {
      catalog: serverData.catalog.map((item) => ({ ...item })),
      models: serverData.models.map((item) => ({ ...item })),
    };
    return data;
  };

  const toastFn = ((toast) => {
    toastCalls.push(toast);
    return {
      id: "toast-id",
      dismiss: () => undefined,
      update: () => undefined,
    };
  }) as ToggleOptions["toastFn"];

  return {
    get data() {
      return data;
    },
    serverData,
    mutate,
    mutateCalls,
    toastCalls,
    toastFn,
  };
}

export function deferred<T = Response>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const settle = () => new Promise((done) => setImmediate(done));

/** A fetch whose PATCHes resolve only when the test says so. */
export function controlledFetch(
  harness: ReturnType<typeof createHarness>,
  model: CatalogModel
) {
  const bodies: boolean[] = [];
  const pending: Array<{ resolve: (value: Response) => void }> = [];
  const fetchFn: typeof fetch = (_input, init) => {
    const enabled = JSON.parse(String(init?.body)).is_enabled as boolean;
    const response = deferred();
    pending.push(response);
    bodies.push(enabled);
    return response.promise.then((value) => {
      const updated = { ...model, is_enabled: enabled };
      harness.serverData.catalog = [updated];
      harness.serverData.models = enabled ? [updated] : [];
      return value;
    });
  };
  const ok = () => new Response(null, { status: 204 });
  return { bodies, pending, fetchFn, ok };
}

export const revalidationsOf = (harness: ReturnType<typeof createHarness>) =>
  harness.mutateCalls.filter((call) => call.update === undefined).length;
