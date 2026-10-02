import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { ActiveScopeProvider } from "../../components/active-scope-provider";

process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND = "neon";

test("assignments share scoped repository data without leaking personal cache entries", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const calls: Array<{ url: string; team: string | null }> = [];
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    EventSource: class extends EventTarget {
      close = () => {
        this.dispatchEvent(new Event("close"));
      };
    },
    fetch: async (url: string, init?: RequestInit) => {
      const team = new Headers(init?.headers).get("x-mogplex-team-id");
      calls.push({ url, team });
      return Response.json(
        url === "/api/repos"
          ? [
              {
                id: team ?? "personal",
                full_name: `${team ?? "personal"}/widgets`,
              },
            ]
          : url === "/api/auth/user"
            ? { user: null }
            : []
      );
    },
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  const { renderHook, waitFor } = await import("@testing-library/react");
  const { useAssignments } = await import("../../hooks/use-assignments");
  const { useRepos } = await import("../../hooks/use-repos");
  let teamId: string | null = "team-a";
  const cache = new Map();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      SWRConfig,
      {
        value: {
          provider: () => cache,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
        },
      },
      createElement(ActiveScopeProvider, { teamId, children })
    );
  const view = renderHook(
    () => ({ assignments: useAssignments(), repos: useRepos() }),
    { wrapper }
  );
  try {
    await waitFor(() =>
      assert.equal(view.result.current.assignments.repos[0]?.id, "team-a")
    );
    assert.deepEqual(
      calls.filter((call) => call.url === "/api/repos"),
      [{ url: "/api/repos", team: "team-a" }]
    );
    teamId = null;
    view.rerender();
    assert.equal(view.result.current.assignments.repos.length, 0);
    await waitFor(() =>
      assert.equal(view.result.current.assignments.repos[0]?.id, "personal")
    );
    assert.equal(view.result.current.repos.repos[0]?.id, "personal");
    assert.deepEqual(
      calls.filter((call) => call.url === "/api/repos"),
      [
        { url: "/api/repos", team: "team-a" },
        { url: "/api/repos", team: null },
      ]
    );
  } finally {
    view.unmount();
    dom.window.close();
    for (const key of Object.keys(values)) {
      if (descriptors[key])
        Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
