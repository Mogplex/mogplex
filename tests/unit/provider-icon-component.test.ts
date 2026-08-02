import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { JSDOM } from "jsdom";

test("getProviderSet reuses one Set for a shared SWR provider array", async () => {
  const { getProviderSet } = await import("../../hooks/use-provider-icons");
  const providers = ["openai", "google"];

  assert.equal(getProviderSet(providers), getProviderSet(providers));
  assert.notEqual(getProviderSet(providers), getProviderSet([...providers]));
});

test("provider icon requests retry transient failures but not auth failures", async () => {
  const [
    { ClientFetchError },
    { PROVIDER_ICON_SWR_OPTIONS, shouldRetryProviderIconRequest },
  ] = await Promise.all([
    import("../../lib/client-fetch"),
    import("../../hooks/use-provider-icons"),
  ]);

  assert.equal(
    PROVIDER_ICON_SWR_OPTIONS.shouldRetryOnError,
    shouldRetryProviderIconRequest
  );
  assert.equal(PROVIDER_ICON_SWR_OPTIONS.errorRetryCount, 3);
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("unauthorized", 401)),
    false
  );
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("forbidden", 403)),
    false
  );
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("missing", 404)),
    false
  );
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("timeout", 408)),
    true
  );
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("rate limited", 429)),
    true
  );
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("unavailable", 503)),
    true
  );
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("unsupported", 501)),
    false
  );
  assert.equal(
    shouldRetryProviderIconRequest(new ClientFetchError("version", 505)),
    false
  );
  assert.equal(
    shouldRetryProviderIconRequest(
      new ClientFetchError("invalid manifest", null, "invalid_response")
    ),
    false
  );
  assert.equal(shouldRetryProviderIconRequest(new TypeError("offline")), true);
  assert.equal(shouldRetryProviderIconRequest(new Error("unexpected")), false);
});

test("ProviderIcon renders only the fallback after an image failure and resets for a new provider", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let fetchCalls = 0;
  const successfulFetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ providers: ["openai", "google"] }), {
      headers: { "content-type": "application/json" },
    });
  };
  const globalKeys = [
    "window",
    "document",
    "navigator",
    "fetch",
    "HTMLElement",
    "Node",
    "MutationObserver",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const;
  const previousDescriptors = new Map(
    globalKeys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    fetch: {
      configurable: true,
      value: successfulFetch,
    },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Node: { configurable: true, value: dom.window.Node },
    MutationObserver: {
      configurable: true,
      value: dom.window.MutationObserver,
    },
    IS_REACT_ACT_ENVIRONMENT: {
      configurable: true,
      value: true,
      writable: true,
    },
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

  try {
    const [{ fireEvent, render, waitFor }, { ProviderIcon }, { SWRConfig }] =
      await Promise.all([
        import("@testing-library/react"),
        import("../../components/provider-icon"),
        import("swr"),
      ]);
    let failedFetchCalls = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => {
        failedFetchCalls += 1;
        return new Response(JSON.stringify({ error: "session expired" }), {
          headers: { "content-type": "application/json" },
          status: 401,
        });
      },
    });
    const failedView = render(
      createElement(
        SWRConfig,
        {
          value: {
            dedupingInterval: 0,
            provider: () => new Map(),
          },
        },
        createElement(ProviderIcon, { provider: "openai" })
      )
    );

    await waitFor(() => assert.equal(failedFetchCalls, 1));
    await waitFor(() => assert.equal(failedView.container.textContent, "O"));
    failedView.unmount();

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: successfulFetch,
    });
    const cacheProvider = () => new Map();
    const renderIcons = (provider: string) =>
      createElement(
        SWRConfig,
        { value: { dedupingInterval: 0, provider: cacheProvider } },
        createElement(
          "div",
          null,
          createElement(ProviderIcon, { provider }),
          createElement(ProviderIcon, { provider: "google" })
        )
      );
    const view = render(renderIcons("openai"));

    await waitFor(() =>
      assert.equal(view.container.querySelectorAll("img").length, 2)
    );
    assert.equal(fetchCalls, 1);
    const openAiImage = view.container.querySelector("img");

    assert.ok(openAiImage);
    assert.equal(view.container.textContent, "");

    fireEvent.error(openAiImage);
    assert.equal(view.container.querySelectorAll("img").length, 1);
    assert.equal(view.container.textContent, "O");

    view.rerender(renderIcons("google"));
    await waitFor(() =>
      assert.equal(view.container.querySelectorAll("img").length, 2)
    );
    assert.equal(view.container.textContent, "");

    view.rerender(renderIcons("missing"));
    assert.equal(view.container.querySelectorAll("img").length, 1);
    assert.equal(view.container.textContent, "M");
    view.unmount();
  } finally {
    dom.window.close();
    for (const key of globalKeys) {
      const descriptor = previousDescriptors.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
    if (previousPublicUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublicUrl;
    }
  }
});
