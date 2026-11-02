import type { Sandbox } from "@vercel/sandbox";
import { describe, expect, it } from "vitest";
import {
  bootstrapSandbox,
  bootstrapSandboxStreaming,
} from "./client-bootstrap";
import { SandboxBootstrapError } from "./client-validation";
import type { SandboxBootstrapStreamEvent } from "./events";
import {
  handOffSetupFailures,
  setupFailureMessage,
  setupIssueFromError,
  setupIssueRecordFields,
  setupIssueSkipsSnapshotWarmup,
} from "./setup-issue";

/** Sandbox whose install command fails with `installOutput` on stdout. */
function failingInstallSandbox(installOutput: string) {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ scripts: { dev: "next dev" } }),
  };
  return {
    readFile: async ({ path }: { path: string }) => (path in files ? {} : null),
    readFileToBuffer: async ({ path }: { path: string }) =>
      path in files ? Buffer.from(files[path] ?? "") : null,
    writeFiles: async () => {},
    runCommand: async ({ args }: { cmd: string; args: string[] }) => {
      const command = args.join(" ");
      const failing = /\binstall\b/.test(command);
      return {
        exitCode: failing ? 1 : 0,
        stdout: async () =>
          args[1] === "process.versions.node"
            ? "22.11.0\n"
            : args[1]?.includes("const packages = []")
              ? "[]"
              : "",
        stderr: async () => "",
        async *logs() {
          if (failing) yield { stream: "stdout", data: installOutput };
        },
        wait: async () => ({ exitCode: failing ? 1 : 0 }),
      };
    },
    domain: (port: number) => `https://preview-${port}.example.test`,
  } as unknown as Sandbox;
}

async function collect(stream: AsyncGenerator<SandboxBootstrapStreamEvent>) {
  const events: SandboxBootstrapStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function* throwing(
  error: unknown,
  before: SandboxBootstrapStreamEvent[] = []
): AsyncGenerator<SandboxBootstrapStreamEvent> {
  yield* before;
  throw error;
}

describe("project setup hand-off", () => {
  it("should keep a streaming boot running and report a failed install", async () => {
    const sandbox = failingInstallSandbox(
      "npm error ERESOLVE could not resolve"
    );

    const events = await collect(bootstrapSandboxStreaming(sandbox));

    expect(events).toContainEqual({
      type: "setup_issue",
      issue: expect.objectContaining({
        phase: "install",
        message: expect.stringContaining("Install failed"),
        logTail: expect.stringContaining("ERESOLVE"),
      }),
    });
    expect(events).toContainEqual({
      type: "preview_url",
      url: "https://preview-3000.example.test",
    });
    expect(events.at(-1)).toEqual({ type: "status", status: "running" });
  });

  it("should still fail the blocking boot used by automations", async () => {
    const sandbox = failingInstallSandbox("npm error ERESOLVE");

    await expect(bootstrapSandbox(sandbox)).rejects.toThrow(
      SandboxBootstrapError
    );
  });

  it("should flag a missing environment variable in a failed dev server", async () => {
    const error = new SandboxBootstrapError("Dev server exited", {
      phase: "dev",
      previewUrl: "https://preview-3000.example.test",
      devLog:
        "PrismaClientInitializationError: Environment variable not found: DATABASE_URL",
    });

    const events = await collect(
      handOffSetupFailures(
        throwing(error, [
          { type: "preview_url", url: "https://preview-3000.example.test" },
        ])
      )
    );

    expect(events).toContainEqual({
      type: "setup_issue",
      issue: {
        phase: "dev",
        message: "Dev server exited",
        logTail: expect.stringContaining("DATABASE_URL"),
        envVarHint: "Missing Prisma datasource environment variable",
      },
    });
    expect(events.filter((event) => event.type === "preview_url")).toHaveLength(
      1
    );
  });

  it("should redact secrets from the log tail before the agent or record sees it", () => {
    const issue = setupIssueFromError(
      new SandboxBootstrapError("Install failed (npm ci)", {
        phase: "install",
        installLog:
          "GET https://registry.example.test\nAuthorization: Bearer npm_live_s3cretvalue\nnpm error 401",
      })
    );

    expect(issue.logTail).toContain("npm error 401");
    expect(issue.logTail).not.toContain("npm_live_s3cretvalue");
    expect(
      JSON.stringify(setupIssueRecordFields(issue, "record-1"))
    ).not.toContain("npm_live_s3cretvalue");
  });

  it("should keep a failure message when the error starts with a blank line", () => {
    const issue = setupIssueFromError(
      new SandboxBootstrapError("\nInstall failed", { phase: "install" })
    );

    expect(issue.message).toBe("Project setup failed");
    expect(setupIssueRecordFields(issue, "record-1")).toMatchObject({
      last_boot_error: "Project setup failed",
    });
  });

  it("should skip the baseline snapshot build only when dependencies never installed", () => {
    const issue = (phase: "detect" | "prerequisite" | "install" | "dev") => ({
      phase,
      message: "failed",
      logTail: "",
      envVarHint: null,
    });

    expect(setupIssueSkipsSnapshotWarmup(issue("install"))).toBe(true);
    expect(setupIssueSkipsSnapshotWarmup(issue("prerequisite"))).toBe(true);
    expect(setupIssueSkipsSnapshotWarmup(issue("dev"))).toBe(false);
    expect(setupIssueSkipsSnapshotWarmup(issue("detect"))).toBe(false);
    expect(setupIssueSkipsSnapshotWarmup(null)).toBe(false);
  });

  it("should rethrow errors that are not project setup failures", async () => {
    await expect(
      collect(handOffSetupFailures(throwing(new Error("VM gone"))))
    ).rejects.toThrow("VM gone");
  });

  it("should report an unrecognized project without recording a boot error", async () => {
    const sandbox = failingInstallSandbox("");
    (sandbox as unknown as { readFile: () => Promise<null> }).readFile =
      async () => null;
    (
      sandbox as unknown as { readFileToBuffer: () => Promise<null> }
    ).readFileToBuffer = async () => null;

    const events = await collect(bootstrapSandboxStreaming(sandbox));
    const issue = events.find((event) => event.type === "setup_issue");

    expect(issue).toMatchObject({ issue: { phase: "detect" } });
    expect(
      setupFailureMessage(issue?.type === "setup_issue" ? issue.issue : null)
    ).toBeNull();
    expect(
      setupFailureMessage({
        phase: "install",
        message: "Install failed (npm install)",
        logTail: "",
        envVarHint: null,
      })
    ).toBe("Install failed (npm install)");
  });
});

describe("setup issue record fields", () => {
  it("should record a failed step with its log and app_error health", () => {
    expect(
      setupIssueRecordFields(
        {
          phase: "install",
          message: "Install failed (npm ci)",
          logTail: "npm error ERESOLVE",
          envVarHint: null,
        },
        "record-1"
      )
    ).toEqual({
      last_boot_error: "Install failed (npm ci)",
      health_status: "app_error",
      error: null,
      install_log: "npm error ERESOLVE",
    });
  });

  it("should record nothing beyond a cleared boot error for an unrecognized project", () => {
    expect(
      setupIssueRecordFields(
        {
          phase: "detect",
          message: "No manifest",
          logTail: "",
          envVarHint: null,
        },
        "record-1"
      )
    ).toEqual({ last_boot_error: null });
    expect(setupIssueRecordFields(null, "record-1")).toEqual({
      last_boot_error: null,
    });
  });
});
