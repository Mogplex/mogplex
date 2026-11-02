import { expect, it } from "vitest";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { createControlVerificationGate } from "./gate";
import { CHECK_KINDS } from "./plan";
import type {
  RepositoryCheckReceipt,
  createRepositoryCheckProbe,
} from "./tool";

const options = { context: {}, toolCallId: "tool-1", messages: [] };
const revision = (value: string) => value.repeat(64);
const receipt = (value: string): RepositoryCheckReceipt => ({
  ok: true,
  verified: true,
  receiptVersion: 1,
  commandCompletion: "confirmed",
  sandboxId: "workspace-1",
  workspaceRevisionBefore: revision(value),
  workspaceRevisionAfter: revision(value),
  checks: CHECK_KINDS.map((kind) => ({
    kind,
    command: `CI=1 pnpm run ${kind}`,
    status: "passed",
    exitCode: 0,
  })),
});

function fixture() {
  let source = "a";
  let observation: "ok" | "known_failure" | "lost" = "ok";
  let checkResult: RepositoryCheckReceipt | undefined;
  const inspections: string[] = [];
  const effects: string[] = [];
  const paths = new Set<string>();
  const inspect: ReturnType<typeof createRepositoryCheckProbe> = async () => {
    inspections.push(source);
    if (observation !== "ok")
      return {
        ok: false,
        error: "Workspace inspection unavailable.",
        commandCompletion:
          observation === "known_failure" ? "confirmed" : "unknown",
      };
    return {
      ok: true,
      sandboxId: "workspace-1",
      revision: revision(source),
      manifest: {
        available: true,
        packageManager: "pnpm@10.12.4",
        lockfiles: [],
        scripts: Object.fromEntries(
          CHECK_KINDS.map((kind) => [kind, "defined"])
        ),
      },
    };
  };
  const gate = createControlVerificationGate(
    {
      userId: "user-1",
      repoId: "repo-1",
      verificationPaths: paths,
      sandboxBinding: { sandboxId: "workspace-1", status: "running" },
    },
    inspect
  );
  const tools = gate.wrapTools({
    read_file: tool({
      inputSchema: z.object({}),
      execute: async () => ({ content: source }),
    }),
    write_file: tool({
      inputSchema: z.object({ path: z.string() }),
      execute: async () => {
        effects.push("write");
        source = source === "a" ? "b" : "c";
        return { sandboxId: "workspace-1", path: "index.ts" };
      },
    }),
    run_command: tool({
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        effects.push(command);
        if (command === "rewrite") source = "c";
        if (command === "lost") return { error: "Lost observation" };
        if (command === "not_started")
          return { commandStarted: false, error: "Sandbox pending" };
        return { sandboxId: "workspace-1", exitCode: 0, stdout: "Passed" };
      },
    }),
    run_checks: tool({
      inputSchema: z.object({}),
      execute: async () => checkResult ?? receipt(source),
    }),
    open_pr: tool({
      inputSchema: z.object({}),
      execute: async () => {
        effects.push("open_pr");
        return { ok: true };
      },
    }),
  });
  let call = 0;
  const run = (
    name: keyof ToolSet,
    input = {},
    toolCallId = `tool-${++call}`
  ) => tools[name].execute!(input, { ...options, toolCallId });
  return {
    gate,
    run,
    effects,
    inspections,
    paths,
    setObservation: (value: typeof observation) => {
      observation = value;
    },
    setReceipt: (value: RepositoryCheckReceipt) => {
      checkResult = value;
    },
  };
}

it("leaves an inspection-only turn free to finish without launching compute", async () => {
  const f = fixture();
  await f.run("read_file");
  expect(await f.gate.prepareStep()()).toEqual({});
  expect(f.inspections).toHaveLength(0);
});

it("requires tools after an edit, records ignored paths, and releases completion after matching checks", async () => {
  const f = fixture();
  await f.run("write_file", { path: ".mogplex/identity.ts" });
  expect(f.paths.has(".mogplex/identity.ts")).toBe(true);
  expect(await f.gate.prepareStep()()).toMatchObject({
    toolChoice: "required",
  });
  await f.run("run_checks");
  expect(await f.gate.prepareStep()()).toEqual({});
  expect(f.gate.summary().verified).toBe(true);
});

it("invalidates verification when a later shell command changes the source", async () => {
  const f = fixture();
  await f.run("write_file", { path: "index.ts" });
  await f.run("run_checks");
  await f.run("run_command", { command: "rewrite" });
  expect(f.gate.summary()).toMatchObject({ required: true, verified: false });
});

it("accepts four exact full manual commands without accepting a focused test as full verification", async () => {
  const f = fixture();
  await f.run("write_file", { path: "index.ts" });
  for (const command of [
    "pnpm typecheck",
    "pnpm lint",
    "pnpm build",
    "pnpm test -- index.test.ts",
  ])
    await f.run("run_command", { command });
  expect(f.gate.summary().required).toBe(true);
  await f.run("run_command", { command: "pnpm test" });
  expect(f.gate.summary()).toMatchObject({ required: false, verified: true });
});

it("refuses delivery before checks without consuming the protected side effect", async () => {
  const f = fixture();
  await f.run("open_pr");
  expect(f.effects).not.toContain("open_pr");
  expect(f.gate.summary().required).toBe(true);
  await f.run("run_checks");
  await f.run("open_pr");
  expect(f.effects).toEqual(["open_pr"]);
});

it("runs no final probe or checkpoint after losing command observation", async () => {
  const f = fixture();
  await f.run("write_file", { path: "index.ts" });
  f.inspections.length = 0;
  await f.run("run_command", { command: "lost" });
  expect(f.inspections).toHaveLength(1);
  const captures: string[] = [];
  await f.gate.checkpoint(async (name) => {
    captures.push(name);
  })("run_command");
  expect(captures).toEqual([]);
  const effects = f.effects.length;
  await f.run("run_command", { command: "pnpm build" });
  expect(f.effects).toHaveLength(effects);
  expect(f.gate.summary()).toMatchObject({ required: false, verified: false });
});

it("allows useful edits after a confirmed inspection failure while reporting unavailable verification", async () => {
  const f = fixture();
  f.setObservation("known_failure");
  await f.run("write_file", { path: "index.ts" });
  expect(f.effects).toEqual(["write"]);
  expect(f.gate.summary()).toMatchObject({ changed: true, verified: false });
});

it("stops before a shell command if the inspection itself may still be running", async () => {
  const f = fixture();
  f.setObservation("lost");
  await f.run("run_command", { command: "rewrite" });
  expect(f.effects).toEqual([]);
  expect(f.gate.summary().verified).toBe(false);
});

it("allows recovery edits after checks report a confirmed inspection failure", async () => {
  const f = fixture();
  f.setReceipt({
    ...receipt("a"),
    ok: false,
    commandCompletion: "confirmed",
    workspaceRevisionBefore: null,
    workspaceRevisionAfter: null,
    checks: receipt("a").checks.map((row) => ({
      ...row,
      command: null,
      status: "blocked",
      exitCode: null,
    })),
  } as RepositoryCheckReceipt);
  await f.run("run_checks");
  await f.run("write_file", { path: "index.ts" });
  expect(f.effects).toEqual(["write"]);
  expect(f.gate.summary().verified).toBe(false);
});

it("does not force a denied check repeatedly and keeps the background cancellation guard", async () => {
  const f = fixture();
  await f.run("write_file", { path: "index.ts" });
  f.gate.onToolEnd({
    toolCall: { toolName: "run_checks" },
    output: { error: "Denied", reason: "policy_violation" },
  });
  expect(await f.gate.prepareStep()()).toEqual({});
  expect(f.gate.summary().verified).toBe(false);
  await expect(
    f.gate.prepareStep(async () => {
      throw new Error("Cancelled");
    })()
  ).rejects.toThrow("Cancelled");
});

it("refuses delivery after a confirmed inspection failure and permits repair then checks", async () => {
  const f = fixture();
  f.setObservation("known_failure");
  await f.run("write_file", { path: "package.json" });
  expect(await f.run("open_pr")).toMatchObject({
    ok: false,
    reason: "verification_unconfirmed",
  });
  expect(f.effects).toEqual(["write"]);
  f.setObservation("ok");
  await f.run("run_command", { command: "repair" });
  await f.run("run_checks");
  await f.run("open_pr");
  expect(f.effects).toEqual(["write", "repair", "open_pr"]);
  expect(f.gate.summary().verified).toBe(true);
});

it("allows a command rejected before launch to recover without latching an unknown execution", async () => {
  const f = fixture();
  await f.run("run_command", { command: "not_started" });
  await f.run("write_file", { path: "index.ts" });
  await f.run("run_checks");
  expect(f.effects).toEqual(["not_started", "write"]);
  expect(f.gate.summary().verified).toBe(true);
});

it("records a check call once so the SDK callback cannot replace its specific failure", async () => {
  const f = fixture();
  const error = "Workspace inspection failed after the command finished.";
  f.setReceipt({
    ...receipt("a"),
    ok: false,
    workspaceRevisionAfter: null,
    error,
  });
  await f.run("run_checks", {}, "checked-call");
  f.gate.onToolEnd({
    toolCall: { toolName: "run_checks", toolCallId: "checked-call" },
  });
  expect(f.gate.summary().error).toBe(error);
});

it("invalidates proof after file edits without scanning the whole repository per edit", async () => {
  const f = fixture();
  await f.run("write_file", { path: ".mogplex/identity.ts" });
  expect(f.inspections).toEqual([]);
  expect(f.gate.summary()).toMatchObject({
    changed: true,
    required: true,
    verified: false,
  });
});

it("a late SDK callback cannot verify contents changed after its check call", async () => {
  const f = fixture();
  await f.run("write_file", { path: "index.ts" });
  await f.run("run_checks", {}, "checked-call");
  await f.run("write_file", { path: "index.ts" });
  f.gate.onToolEnd({
    toolCall: { toolName: "run_checks", toolCallId: "checked-call" },
    output: receipt("b"),
  });
  expect(f.gate.summary()).toMatchObject({ required: true, verified: false });
});
