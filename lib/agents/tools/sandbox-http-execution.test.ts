import { afterEach, expect, it, vi } from "vitest";
import { postSandboxExec } from "./sandbox-http-execution";

afterEach(() => vi.unstubAllGlobals());

function serve(response: Response) {
  const fetch = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function stream(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    {
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

it("requests progress immediately and preserves auth/body while bounding streamed output", async () => {
  const fetch = serve(
    stream([
      { type: "run", cmdId: "test-command" },
      { type: "log", stream: "stdout", data: "a".repeat(9999) },
      { type: "log", stream: "stdout", data: "bc" },
      { type: "log", stream: "stderr", data: "e".repeat(5001) },
      { type: "done", exitCode: 2, cwd: "/workspace" },
    ])
  );
  const headers = new Headers({
    authorization: "Bearer fixture",
    "content-type": "application/json",
  });
  const response = await postSandboxExec("sandbox-1", headers, {
    command: "pwd",
    cwd: "/workspace",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    stdout: "a".repeat(9999) + "b",
    stderr: "e".repeat(5000),
    exitCode: 2,
    cwd: "/workspace",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(request[0]).toMatch(/\/api\/sandbox\/sandbox-1\/exec$/);
  expect(request[1].method).toBe("POST");
  expect(new Headers(request[1].headers).get("accept")).toBe(
    "text/event-stream"
  );
  expect(new Headers(request[1].headers).get("authorization")).toBe(
    "Bearer fixture"
  );
  expect(request[1].body).toBe(
    JSON.stringify({ command: "pwd", cwd: "/workspace" })
  );
  expect(headers.has("accept")).toBe(false);
});

it.each([200, 400, 401, 403, 410])(
  "preserves immediate HTTP %s responses",
  async (status) => {
    const response = Response.json(
      status === 200 ? { exitCode: 0, stdout: "ok" } : { error: "Rejected" },
      { status }
    );
    serve(response);
    expect(await postSandboxExec("sandbox-1", {}, { command: "pwd" })).toBe(
      response
    );
  }
);

it.each([
  {
    events: [{ type: "error", data: "provider failure" }],
    error: "provider failure",
  },
  { events: [{ type: "error", data: "" }], error: "" },
  { events: [{ type: "cancelled" }], error: "Command cancelled." },
  {
    events: [{ type: "run", cmdId: "test-command" }],
    error:
      "Terminal connection ended before command completion. Check the sandbox before retrying.",
  },
])("reports $error without replay", async ({ events, error }) => {
  const fetch = serve(stream(events));
  const response = await postSandboxExec("sandbox-1", {}, { command: "pwd" });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves unknown completion exit codes", async () => {
  serve(stream([{ type: "done", exitCode: null, cwd: "/workspace" }]));
  const response = await postSandboxExec("sandbox-1", {}, { command: "pwd" });
  expect(await response.json()).toEqual({
    stdout: "",
    stderr: "",
    exitCode: null,
    cwd: "/workspace",
  });
});

it("reports an unreadable stream without a command replay", async () => {
  const fetch = serve(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error("lost");
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } }
    )
  );
  const response = await postSandboxExec("sandbox-1", {}, { command: "pwd" });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Terminal stream failed before command completion.",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
