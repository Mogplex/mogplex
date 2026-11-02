import { describe, expect, it } from "vitest";
import {
  installSandboxRows,
  OWNED_REPO_ID,
} from "../../../tests/support/sandbox-resolution-fixture";
import { createStartSandbox } from "./sandbox";

function sseResponse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

async function startSandbox() {
  const tool = createStartSandbox("user-1") as unknown as {
    execute: (input: { repoId: string }) => Promise<Record<string, unknown>>;
  };
  installSandboxRows([]);
  return tool.execute({ repoId: OWNED_REPO_ID });
}

describe("sandbox_start with a project setup issue", () => {
  it("should hand the agent the setup issue from a boot that kept running", async () => {
    const issue = {
      phase: "install",
      message: "Install failed (npm install --ignore-scripts)",
      logTail: "npm error ERESOLVE could not resolve",
      envVarHint: null,
    };
    global.fetch = async () =>
      sseResponse([
        { type: "sandbox_created", recordId: "sandbox-new" },
        { type: "setup_issue", issue },
        { type: "ready", sandbox: { id: "sandbox-new", status: "running" } },
      ]);

    const result = await startSandbox();

    expect(result).toMatchObject({
      ok: true,
      sandboxId: "sandbox-new",
      status: "running",
      setupIssue: issue,
    });
    expect(result.message).toContain(
      "Sandbox is running, but the dependency install did not finish"
    );
    expect(result.message).toContain("<environment_setup>");
  });

  it("should ignore a malformed setup issue and report a plain ready sandbox", async () => {
    global.fetch = async () =>
      sseResponse([
        { type: "setup_issue", issue: { phase: "deploy", message: 42 } },
        { type: "ready", sandbox: { id: "sandbox-new", status: "running" } },
      ]);

    const result = await startSandbox();

    expect(result).not.toHaveProperty("setupIssue");
    expect(result.message).toBe("Sandbox is ready to use.");
  });
});

describe("sandbox_start for a repo with no project manifest", () => {
  it("should report a ready sandbox rather than a failed setup step", async () => {
    global.fetch = async () =>
      sseResponse([
        {
          type: "setup_issue",
          issue: {
            phase: "detect",
            message:
              "No package.json, pyproject.toml or requirements.txt found",
            logTail: "",
            envVarHint: null,
          },
        },
        { type: "ready", sandbox: { id: "sandbox-new", status: "running" } },
      ]);

    const result = await startSandbox();

    expect(result.message).toContain(
      "Sandbox is ready. No project manifest was detected"
    );
    expect(result.message).not.toContain("did not finish");
  });
});

describe("sandbox_start reusing a sandbox whose setup failed", () => {
  it("should tell the agent about the last boot's setup failure", async () => {
    installSandboxRows([
      { id: "sandbox-running", last_boot_error: "Install failed (npm ci)" },
    ]);
    const tool = createStartSandbox("user-1") as unknown as {
      execute: (input: { repoId: string }) => Promise<Record<string, unknown>>;
    };

    const result = await tool.execute({ repoId: OWNED_REPO_ID });

    expect(result).toMatchObject({
      sandboxId: "sandbox-running",
      sandboxResolution: "reused_running",
      lastBootError: "Install failed (npm ci)",
    });
    expect(result.message).toContain(
      "its last boot did not finish project setup: Install failed (npm ci)"
    );
  });

  it("should keep a setup issue streamed before a reattach", async () => {
    const issue = {
      phase: "dev",
      message: "Dev server exited",
      logTail: "Error: listen EADDRINUSE",
      envVarHint: null,
    };
    const responses = [
      sseResponse([
        { type: "sandbox_created", recordId: "sandbox-new" },
        { type: "setup_issue", issue },
      ]),
      sseResponse([
        { type: "ready", sandbox: { id: "sandbox-new", status: "running" } },
      ]),
    ];
    global.fetch = async () => responses.shift() ?? new Response(null);

    const result = await startSandbox();

    expect(result).toMatchObject({
      sandboxId: "sandbox-new",
      setupIssue: issue,
    });
  });
});
