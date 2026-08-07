export type ToolLike = {
  execute: (
    input: Record<string, unknown>,
    options?: unknown
  ) => Promise<unknown>;
};

export function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

export const FAILING_SHA = "badc0ffee0000000000000000000000000000000";
export const PARENT_SHA = "0000000000000000000000000000000000000001";

export function leftoverBranchMock(leftoverTip: {
  parents: Array<{ sha: string }>;
  tree: { sha: string };
}) {
  let patched = false;
  const handler = (url: string, init?: RequestInit) => {
    if (url.includes("/pulls?head=")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits/leftover")) {
      return new Response(JSON.stringify(leftoverTip), { status: 200 });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      return new Response("already exists", { status: 422 });
    }
    if (!init?.method && url.includes("/git/ref/heads/mogplex/revert-")) {
      // Collision-vs-invalid check: the leftover ref really exists.
      return new Response(JSON.stringify({ object: { sha: "leftover" } }), {
        status: 200,
      });
    }
    if (init?.method === "PATCH" && url.includes("/git/refs/heads/")) {
      patched = true;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      return new Response(
        JSON.stringify({ number: 91, html_url: "https://github.com/pr/91" }),
        { status: 201 }
      );
    }
    return new Response("unexpected", { status: 500 });
  };
  return { handler, wasPatched: () => patched };
}

export function raceMockHandlers(input: {
  lookupResponses: Array<Array<Record<string, unknown>>>;
  refCreateStatus: number;
  prCreateStatus: number;
  revertBranchRefSha?: string;
  revertBranchRefStatus?: number;
}) {
  let lookupCall = 0;
  const events: string[] = [];
  const handler = (url: string, init?: RequestInit) => {
    if (url.includes("/pulls?head=")) {
      const body = input.lookupResponses[lookupCall] ?? [];
      lookupCall += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: FAILING_SHA } }), {
        status: 200,
      });
    }
    if (!init?.method && url.includes("/git/ref/heads/mogplex/revert-")) {
      const status = input.revertBranchRefStatus ?? 200;
      if (status !== 200) {
        return new Response("missing", { status });
      }
      return new Response(
        JSON.stringify({
          object: { sha: input.revertBranchRefSha ?? "revertsha" },
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${FAILING_SHA}`)) {
      return new Response(
        JSON.stringify({
          message: "feat: bad",
          parents: [{ sha: PARENT_SHA }],
        }),
        { status: 200 }
      );
    }
    if (url.endsWith(`/git/commits/${PARENT_SHA}`)) {
      return new Response(JSON.stringify({ tree: { sha: "t" } }), {
        status: 200,
      });
    }
    if (url.endsWith("/git/commits") && init?.method === "POST") {
      return new Response(JSON.stringify({ sha: "revertsha" }), {
        status: 201,
      });
    }
    if (url.endsWith("/git/refs") && init?.method === "POST") {
      return new Response(
        input.refCreateStatus === 201 ? JSON.stringify({}) : "exists",
        { status: input.refCreateStatus }
      );
    }
    if (init?.method === "PATCH" && url.includes("/git/refs/heads/")) {
      events.push("patch");
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (init?.method === "DELETE" && url.includes("/git/refs/heads/")) {
      events.push("delete");
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/pulls") && init?.method === "POST") {
      return new Response(
        input.prCreateStatus === 201
          ? JSON.stringify({ number: 99, html_url: "https://github.com/pr/99" })
          : "exists",
        { status: input.prCreateStatus }
      );
    }
    return new Response("unexpected", { status: 500 });
  };
  return { handler, events };
}

export const RACE_REVERT = {
  githubToken: "token",
  owner: "acme",
  repo: "widgets",
  revert: { failingSha: FAILING_SHA, branch: "main" },
};

export { buildRevertBranchName } from "../../../lib/agents/ci-tools";
