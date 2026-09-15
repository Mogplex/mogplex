import assert from "node:assert/strict";
import test from "node:test";

test("runtime defaults use their own surface, and explicit selections still win", async () => {
  process.env.MOGPLEX_DATA_BACKEND = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://surface-fixture.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  const account = "openai/account";
  const surfaces = {
    chat: "openai/chat",
    cli: "openai/cli",
    slack: "openai/slack",
    control: "openai/control",
    agents: "openai/agents",
  };
  let preference: string | null = null;
  let failTable: string | null = null;
  let rpcError: string | null = null;
  let visibleFlows = [{ id: "flow", name: "My automation", team_id: null }];
  let reachable = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "surface-fixture.supabase.co");
    const table = url.pathname.split("/").at(-1)!;
    if (table === failTable)
      return Response.json({ message: "unavailable" }, { status: 500 });
    if (table === "apply_model_defaults") {
      if (rpcError)
        return Response.json(
          { code: rpcError, message: "failure" },
          { status: 400 }
        );
      const body = JSON.parse(String(init?.body)) as {
        p_user_id: string;
        p_surfaces: string[];
      };
      assert.equal(body.p_user_id, "surface-user");
      return Response.json({ drafts_updated: 1, versions_published: 1 });
    }
    const profile = {
      default_model: account,
      surface_models: surfaces,
      auto_enable_new_models: true,
      models_seen_at: null,
      id: "surface-user",
      email: null,
      allow_platform_ai: true,
      allow_platform_sandbox: true,
    };
    const catalog = [account, ...Object.values(surfaces)].map((id) => ({
      id,
      name: id,
      provider: "openai",
      is_available: true,
      capabilities: ["tool-use"],
    }));
    const rows: Record<string, unknown> = {
      profiles: profile,
      ai_models: catalog,
      user_model_preferences: [],
      provider_keys: reachable ? [{ provider: "openai" }] : [],
      slack_model_preferences: preference ? [{ model_id: preference }] : [],
      flows: visibleFlows,
    };
    assert.ok(table in rows, `unexpected database request ${table}`);
    // Honor the projection, so a caller forgetting surface_models reproduces the bug.
    if (table === "profiles") {
      const selected = new Set(
        (url.searchParams.get("select") ?? "").split(",")
      );
      return Response.json(
        Object.fromEntries(
          Object.entries(profile).filter(([key]) => selected.has(key))
        )
      );
    }
    return Response.json(rows[table]);
  };
  try {
    const { resolveCliModelId } =
      await import("../../app/api/cli/inference/chat/completions/model-resolution");
    const { resolveChatModelId } = await import("../../lib/agents/run-chat");
    const { resolveControlChatModelId } =
      await import("../../app/api/control/chat/_lib/context");
    const { resolveStoredUserDefaultModelId } =
      await import("../../lib/models/default-model");
    const { resolveSlackTurnModel } =
      await import("../../lib/slack/turn-model-resolve");
    assert.equal(await resolveCliModelId("surface-user"), surfaces.cli);
    const { createSettingsGetHandler } =
      await import("../../app/api/settings/route");
    const settings = createSettingsGetHandler({
      requireUserId: async () => "surface-user",
    });
    // The released CLI bootstraps from this exact URL/header contract.
    assert.equal(
      (
        await (
          await settings(
            new Request("https://mogplex.test/api/settings", {
              headers: { Authorization: "Bearer cli-fixture" },
            })
          )
        ).json()
      ).default_model,
      surfaces.cli
    );
    assert.equal(
      (
        await (
          await settings(
            new Request("https://mogplex.test/api/settings?surface=chat")
          )
        ).json()
      ).default_model,
      surfaces.chat
    );
    assert.equal(
      (
        await (
          await settings(new Request("https://mogplex.test/api/settings"))
        ).json()
      ).default_model,
      account
    );
    assert.equal(
      await resolveCliModelId("surface-user", "openai/explicit"),
      "openai/explicit"
    );
    assert.equal(await resolveChatModelId("surface-user"), surfaces.chat);
    assert.equal(
      await resolveChatModelId("surface-user", "openai/explicit"),
      "openai/explicit"
    );
    assert.equal(
      await resolveControlChatModelId("surface-user"),
      surfaces.control
    );
    assert.equal(
      await resolveControlChatModelId("surface-user", "openai/explicit"),
      "openai/explicit"
    );
    assert.equal(
      await resolveStoredUserDefaultModelId("surface-user", {
        surface: "agents",
      }),
      surfaces.agents
    );
    assert.equal(
      await resolveStoredUserDefaultModelId("surface-user"),
      account
    );
    const slackInput = {
      installationId: "i",
      channelId: "c",
      slackUserId: "s",
      mogplexUserId: "surface-user",
      teamId: null,
      conversationModel: account,
      needsVision: false,
    };
    assert.equal(await resolveSlackTurnModel(slackInput), surfaces.slack);
    preference = surfaces.cli;
    assert.equal(await resolveSlackTurnModel(slackInput), surfaces.cli);

    const { applyModelDefaults, loadModelSettingsTargets } =
      await import("../../lib/models/settings-defaults");
    const targets = await loadModelSettingsTargets("surface-user");
    assert.equal(targets.automations[0].name, "My automation");
    assert.deepEqual(
      Object.fromEntries(targets.surfaces.map(({ id, model }) => [id, model])),
      surfaces
    );
    const save = {
      userId: "surface-user",
      model: account,
      surfaces: ["cli" as const],
      flowIds: ["flow"],
    };
    assert.deepEqual(await applyModelDefaults(save), {
      drafts_updated: 1,
      versions_published: 1,
    });
    assert.deepEqual(
      await applyModelDefaults({ ...save, flowIds: [], theme: "light" }),
      { drafts_updated: 1, versions_published: 1 }
    );
    visibleFlows = [];
    await assert.rejects(applyModelDefaults(save), /no longer available/);
    visibleFlows = [{ id: "flow", name: "My automation", team_id: null }];
    reachable = false;
    await assert.rejects(
      applyModelDefaults(save),
      /unavailable for a selected/
    );
    reachable = true;
    for (const code of ["40001", "XX000"]) {
      rpcError = code;
      await assert.rejects(
        applyModelDefaults(save),
        code === "40001" ? /changed while saving/ : /No changes were applied/
      );
    }
    rpcError = null;
    for (const table of ["profiles", "flows"]) {
      failTable = table;
      await assert.rejects(
        loadModelSettingsTargets("surface-user"),
        /Unable to load/
      );
      await assert.rejects(applyModelDefaults(save), /Unable to load/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
