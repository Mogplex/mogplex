import { createTriggerApiTools } from "../../lib/connections/trigger-api/tools";

export type RecordedTriggerCall = {
  method: string;
  path: string;
  url: string;
  authorization: string | null;
  branch: string | null;
  body: unknown;
};

type Route = { status?: number; body: unknown; contentType?: string };

export const TRIGGER_TEST_PAT = "tr_pat_test";
export const TRIGGER_TEST_JWT = "jwt_scoped";
export const TRIGGER_TEST_ENV_KEY = "tr_prod_environment_key";

/** Token exchange routes for `proj_abc` / `prod`, the target most tests use. */
export const TRIGGER_AUTH_ROUTES: Record<string, Route> = {
  "POST /api/v1/projects/proj_abc/prod/jwt": {
    body: { token: TRIGGER_TEST_JWT },
  },
  "GET /api/v1/projects/proj_abc/prod": {
    body: { apiKey: TRIGGER_TEST_ENV_KEY, name: "Mogplex" },
  },
};

/** Fake Trigger.dev API: answers by `METHOD path`, records what was sent. */
export function fakeTriggerApi(routes: Record<string, Route>) {
  const calls: RecordedTriggerCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname,
      url: url.toString(),
      authorization: headers.get("Authorization"),
      branch: headers.get("x-trigger-branch"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return Response.json({ error: "no route" }, { status: 404 });
    const payload =
      typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(payload, {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "application/json" },
    });
  };
  return { calls, fetchImpl };
}

/** Parse the input through the tool's schema, then execute it. */
export async function executeTriggerTool(
  fetchImpl: typeof fetch,
  name: string,
  input: Record<string, unknown>
) {
  const tools = createTriggerApiTools(TRIGGER_TEST_PAT, fetchImpl);
  const selected = tools[name] as unknown as {
    inputSchema: { parse: (value: unknown) => unknown };
    execute: (input: unknown, options: unknown) => Promise<unknown>;
  };
  return (await selected.execute(
    selected.inputSchema.parse(input),
    {}
  )) as Record<string, unknown>;
}
