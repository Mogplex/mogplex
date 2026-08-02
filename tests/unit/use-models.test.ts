import assert from "node:assert/strict";
import test from "node:test";
import { toggleModelPreference } from "../../hooks/use-models";
import { ACTIVE_TEAM_HEADER } from "../../lib/team-capabilities";
import type { AIModel } from "../../lib/types";

type ToggleOptions = Parameters<typeof toggleModelPreference>[0];
type CatalogModel = ToggleOptions["catalog"][number];
type MutateOptions = Parameters<ToggleOptions["mutate"]>[1];
type ModelsResponse = {
  models: AIModel[];
  catalog: CatalogModel[];
};

function buildCatalogModel(
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

function createHarness({
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

test("toggleModelPreference rolls back optimistic state and warns on failed PATCH responses", async () => {
  const model = buildCatalogModel({ is_enabled: false });
  const harness = createHarness({ model });
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];
  const fetchFn: typeof fetch = async (input, init) => {
    fetchCalls.push({ input, init });
    return new Response(null, { status: 500 });
  };

  await toggleModelPreference({
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, "/api/models");
  assert.equal(fetchCalls[0]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(fetchCalls[0]?.init?.body)), {
    model_id: model.id,
    is_enabled: true,
  });
  assert.equal(harness.mutateCalls.length, 2);
  assert.equal(harness.mutateCalls[0]?.shouldRevalidate, false);
  assert.equal(harness.mutateCalls[1]?.update, undefined);
  assert.equal(harness.data.catalog[0]?.is_enabled, false);
  assert.equal(harness.toastCalls.length, 1);
  assert.equal(harness.toastCalls[0]?.title, "Model preference not saved");
  assert.equal(harness.toastCalls[0]?.variant, "destructive");
});

test("toggleModelPreference persists successful toggles without warning", async () => {
  const model = buildCatalogModel({ is_enabled: false });
  const harness = createHarness({ model });
  const fetchFn: typeof fetch = async () => {
    const updatedModel = { ...model, is_enabled: true };
    harness.serverData.catalog = [updatedModel];
    harness.serverData.models = [updatedModel];
    return new Response(null, { status: 204 });
  };

  await toggleModelPreference({
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  });

  assert.equal(harness.mutateCalls.length, 2);
  assert.equal(harness.mutateCalls[0]?.shouldRevalidate, false);
  assert.equal(harness.mutateCalls[1]?.update, undefined);
  assert.equal(harness.data.catalog[0]?.is_enabled, true);
  assert.equal(harness.data.models[0]?.id, model.id);
  assert.equal(harness.toastCalls.length, 0);
});

test("toggleModelPreference sends the explicit active team header", async () => {
  const model = buildCatalogModel({ is_enabled: false });
  const harness = createHarness({ model });
  let teamHeader: string | null = null;
  const fetchFn: typeof fetch = async (_input, init) => {
    teamHeader = new Headers(init?.headers).get(ACTIVE_TEAM_HEADER);
    return new Response(null, { status: 204 });
  };

  await toggleModelPreference({
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    activeTeamId: "team-1",
    fetchFn,
    toastFn: harness.toastFn,
  });

  assert.equal(teamHeader, "team-1");
});

test("toggleModelPreference omits the team header for personal scope", async () => {
  const model = buildCatalogModel({ is_enabled: false });
  const harness = createHarness({ model });
  let teamHeader: string | null = "unexpected";
  const fetchFn: typeof fetch = async (_input, init) => {
    teamHeader = new Headers(init?.headers).get(ACTIVE_TEAM_HEADER);
    return new Response(null, { status: 204 });
  };

  await toggleModelPreference({
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    activeTeamId: null,
    fetchFn,
    toastFn: harness.toastFn,
  });

  assert.equal(teamHeader, null);
});

test("toggleModelPreference rolls back optimistic state and warns on network errors", async () => {
  const model = buildCatalogModel({ is_enabled: false });
  const harness = createHarness({ model });
  const fetchFn: typeof fetch = async () => {
    throw new Error("network down");
  };

  await toggleModelPreference({
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  });

  assert.equal(harness.mutateCalls.length, 2);
  assert.equal(harness.data.catalog[0]?.is_enabled, false);
  assert.equal(harness.toastCalls.length, 1);
  assert.equal(harness.toastCalls[0]?.title, "Model preference not saved");
  assert.equal(harness.toastCalls[0]?.description, "network down");
});

test("toggleModelPreference keeps PATCH details when rollback revalidation fails", async () => {
  const model = buildCatalogModel({ is_enabled: false });
  const harness = createHarness({ model, revalidateFails: true });
  const fetchFn: typeof fetch = async () => new Response(null, { status: 503 });

  await toggleModelPreference({
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  });

  assert.equal(harness.mutateCalls.length, 2);
  assert.equal(harness.data.catalog[0]?.is_enabled, true);
  assert.equal(harness.toastCalls.length, 1);
  assert.equal(harness.toastCalls[0]?.title, "Model preference not saved");
  assert.match(
    String(harness.toastCalls[0]?.description),
    /Failed to update model preference \(503\)/
  );
  assert.match(
    String(harness.toastCalls[0]?.description),
    /Please reload the page if the displayed state looks incorrect\./
  );
});

test("toggleModelPreference warns when success-path revalidation fails", async () => {
  const model = buildCatalogModel({ is_enabled: false });
  const harness = createHarness({ model, revalidateFails: true });
  const fetchFn: typeof fetch = async () => new Response(null, { status: 204 });

  await toggleModelPreference({
    modelId: model.id,
    catalog: [model],
    mutate: harness.mutate,
    fetchFn,
    toastFn: harness.toastFn,
  });

  assert.equal(harness.mutateCalls.length, 2);
  assert.equal(harness.toastCalls.length, 1);
  assert.equal(harness.toastCalls[0]?.title, "Could not refresh model list");
  assert.equal(
    harness.toastCalls[0]?.description,
    "Please reload the page if the displayed state looks incorrect."
  );
});
