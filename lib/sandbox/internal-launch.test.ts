import { describe, expect, it } from "vitest";
import {
  launchSandboxInternally,
  readSandboxLaunchResponse,
} from "./internal-launch";
import { SANDBOX_READINESS_WAIT_HEADER } from "./readiness-contract";

const record = (sandboxId: string) => ({
  id: "record-1",
  sandbox_id: sandboxId,
  root_directory: null,
});

const sse = (...events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  );

function scripted(...responses: Response[]) {
  const requests: Request[] = [];
  return {
    requests,
    post: async (request: Request) => {
      requests.push(request);
      const next = responses.shift();
      if (!next) throw new Error("unexpected sandbox request");
      return next;
    },
  };
}

const launch = (post: (request: Request) => Promise<Response>) =>
  launchSandboxInternally({
    headers: { "x-internal": "1" },
    body: { repoId: "repo-1", workingBranch: "main" },
    post,
  });

describe("launchSandboxInternally", () => {
  it("should ask the sandbox route to wait for a sandbox another run is booting", async () => {
    const route = scripted(Response.json({ sandbox: record("vm-1") }));

    await launch(route.post);

    expect(route.requests[0].headers.get(SANDBOX_READINESS_WAIT_HEADER)).toBe(
      "1"
    );
    expect(route.requests[0].headers.get("x-internal")).toBe("1");
    expect(await route.requests[0].json()).toEqual({
      repoId: "repo-1",
      workingBranch: "main",
    });
  });

  it("should return the sandbox only once it is ready, not while it is pending", async () => {
    const route = scripted(
      sse(
        { type: "sandbox_created", sandbox: record("pending") },
        { type: "ready", sandbox: record("vm-1") }
      )
    );

    await expect(launch(route.post)).resolves.toEqual({
      recordId: "record-1",
      sandboxId: "vm-1",
      rootDirectory: null,
    });
  });

  it("should reattach rather than use a ready sandbox that still has no VM id", async () => {
    // A waiter that attached while the record was still creating.
    const route = scripted(
      sse(
        { type: "sandbox_created", sandbox: record("pending") },
        { type: "ready", sandbox: record("pending") }
      ),
      Response.json({ sandbox: record("vm-1") })
    );

    await expect(launch(route.post)).resolves.toMatchObject({
      sandboxId: "vm-1",
    });
    expect(route.requests).toHaveLength(2);
  });

  it("should never resolve with a pending VM id", async () => {
    const stale = () =>
      sse(
        { type: "sandbox_created", sandbox: record("pending") },
        { type: "ready", sandbox: record("pending") }
      );
    const route = scripted(stale(), stale());

    await expect(launch(route.post)).rejects.toThrow(
      "Sandbox record-1 did not become ready"
    );
  });

  it("should reattach once when the wait closes without the sandbox being ready", async () => {
    const route = scripted(
      sse(
        { type: "sandbox_created", sandbox: record("pending") },
        { type: "warning", message: "Still starting; reattach." }
      ),
      Response.json({ sandbox: record("vm-1") })
    );

    await expect(launch(route.post)).resolves.toMatchObject({
      sandboxId: "vm-1",
    });
    expect(route.requests).toHaveLength(2);
  });

  it("should fail rather than hand back a sandbox that never became ready", async () => {
    const pending = () =>
      sse({ type: "sandbox_created", sandbox: record("pending") });
    const route = scripted(pending(), pending());

    await expect(launch(route.post)).rejects.toThrow(
      "Sandbox record-1 did not become ready"
    );
  });

  it("should surface the route's boot error", async () => {
    const route = scripted(
      sse(
        { type: "sandbox_created", sandbox: record("pending") },
        { type: "error", message: "Preview did not become ready" }
      )
    );

    await expect(launch(route.post)).rejects.toThrow(
      "Preview did not become ready"
    );
  });

  it("should surface a rejected launch", async () => {
    const route = scripted(
      Response.json({ error: "Repository not found" }, { status: 404 })
    );

    await expect(launch(route.post)).rejects.toThrow("Repository not found");
  });
});

describe("readSandboxLaunchResponse", () => {
  it("should settle on the last sandbox a resume stream named", async () => {
    await expect(
      readSandboxLaunchResponse(
        sse({ type: "sandbox_created", sandbox: record("vm-resumed") })
      )
    ).resolves.toMatchObject({ recordId: "record-1", sandboxId: "vm-resumed" });
  });
});
