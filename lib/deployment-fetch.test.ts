import { describe, expect, it, vi } from "vitest";
import { createDeploymentFetch, deploymentStreamUrl } from "./deployment-fetch";
import { SCHEMA_DRIFT_CODE, SCHEMA_DRIFT_MESSAGE } from "./schema-drift";

const origin = "https://mogplex.test";
function setup(deploymentId = "release-a") {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ok: true }));
  const onSchemaDrift = vi.fn();
  return {
    fetchImpl,
    onSchemaDrift,
    request: createDeploymentFetch(fetchImpl, {
      origin,
      deploymentId,
      onSchemaDrift,
    }),
  };
}

describe("deployment fetch", () => {
  it("keeps an old client pinned while new clients use their own release", async () => {
    const old = setup();
    const current = setup("release-b");
    await old.request("/api/repos");
    await current.request("/api/repos");
    await old.request("/api/repos");
    expect(
      old.fetchImpl.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("x-deployment-id")
      )
    ).toEqual(["release-a", "release-a"]);
    expect(
      new Headers(current.fetchImpl.mock.calls[0][1]?.headers).get(
        "x-deployment-id"
      )
    ).toBe("release-b");
  });

  it("preserves Request bodies, auth, signals, and fetch header override semantics", async () => {
    const { request, fetchImpl } = setup();
    const controller = new AbortController();
    const input = new Request(`${origin}/api/mcp-servers`, {
      method: "POST",
      body: "draft",
      headers: { authorization: "Bearer fixture" },
      signal: controller.signal,
    });
    await request(input);
    const [sent, init] = fetchImpl.mock.calls[0];
    const effective = new Request(sent, init);
    expect(await effective.text()).toBe("draft");
    expect(effective.headers.get("authorization")).toBe("Bearer fixture");
    expect(effective.headers.get("x-deployment-id")).toBe("release-a");
    controller.abort();
    expect(effective.signal.aborted).toBe(true);
    await request(
      new Request(`${origin}/api/repos`, { headers: { old: "discard" } }),
      { headers: { custom: "keep" } }
    );
    const overridden = new Headers(fetchImpl.mock.calls[1][1]?.headers);
    expect(overridden.get("old")).toBeNull();
    expect(overridden.get("custom")).toBe("keep");
  });

  it("does not tag third-party requests, assets, or framework navigations", async () => {
    const { request, fetchImpl } = setup();
    for (const url of [
      "https://provider.test/api/run",
      "//provider.test/api/run",
      "/api-other",
      "/_next/static/app.js",
      "/projects?_rsc=1",
    ]) {
      const init = { headers: { custom: "keep" } };
      await request(url, init);
      expect(fetchImpl).toHaveBeenLastCalledWith(url, init);
    }
  });

  it("leaves local requests and successful streaming responses usable", async () => {
    const { request, fetchImpl } = setup("");
    const stream = new Response("data: token\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    fetchImpl.mockResolvedValue(stream);
    const result = await request("/api/chat");
    expect(result).toBe(stream);
    expect(result.bodyUsed).toBe(false);
    expect(await result.text()).toBe("data: token\n\n");
    expect(
      new Headers(fetchImpl.mock.calls[0][1]?.headers).has("x-deployment-id")
    ).toBe(false);
  });

  it("returns a safe schema failure, signals the notice, and never replays the mutation", async () => {
    const { request, fetchImpl, onSchemaDrift } = setup();
    fetchImpl.mockResolvedValue(
      Response.json(
        {
          code: "42703",
          error: "private_column does not exist",
          details: "private schema",
        },
        { status: 500, headers: { "x-request-id": "request-1", etag: "stale" } }
      )
    );
    const result = await request("/api/mcp-servers", {
      method: "POST",
      body: "draft",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSchemaDrift).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(503);
    expect(result.headers.get("x-request-id")).toBe("request-1");
    expect(result.headers.get("etag")).toBeNull();
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({
      error: SCHEMA_DRIFT_MESSAGE,
      code: SCHEMA_DRIFT_CODE,
    });
  });

  it("does not misclassify validation, authorization, malformed JSON, or network errors", async () => {
    const { request, fetchImpl, onSchemaDrift } = setup();
    for (const response of [
      Response.json({ code: "23505" }, { status: 409 }),
      Response.json({ error: "Unauthorized" }, { status: 401 }),
      new Response("not-json", {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ]) {
      fetchImpl.mockResolvedValue(response);
      expect(await request("/api/repos")).toBe(response);
      expect(response.bodyUsed).toBe(false);
    }
    const offline = new TypeError("offline");
    fetchImpl.mockRejectedValue(offline);
    await expect(request("/api/repos")).rejects.toBe(offline);
    expect(onSchemaDrift).not.toHaveBeenCalled();
  });
});

it("pins SSE URLs without replacing filters or adding tags to external URLs", () => {
  expect(
    deploymentStreamUrl("/api/realtime/events?tables=repos", "release-a")
  ).toBe("/api/realtime/events?tables=repos&dpl=release-a");
  expect(
    deploymentStreamUrl("/api/runs/run-1/stream?dpl=stale", "release-b")
  ).toBe("/api/runs/run-1/stream?dpl=release-b");
  expect(
    deploymentStreamUrl("https://external.test/api/stream", "release-a")
  ).toBe("https://external.test/api/stream");
  expect(deploymentStreamUrl("/api/events", "")).toBe("/api/events");
});
