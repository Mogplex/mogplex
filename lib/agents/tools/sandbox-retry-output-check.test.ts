import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { DecisionScope } from "@/lib/decisions/types";
import { createTerminalExec } from "./sandbox";

const REPO_ID = "00000000-0000-4000-8000-000000000001";
const scope = { surface: "agent_tool", userId: "user-1", riskGate: false };
const HIDDEN_FAILURE = {
  exitCode: 0,
  stdout: "ls: /nope: No such file or directory\nfinished",
  stderr: "",
};

let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;
const originalSecret = process.env.INTERNAL_API_SECRET;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** One running sandbox for the repo, so re-resolution finds "sandbox-new". */
function installRunningSandbox() {
  const sandboxQuery = {
    select: () => sandboxQuery,
    eq: () => sandboxQuery,
    order: () => sandboxQuery,
    limit: async () => ({ data: [{ id: "sandbox-new" }], error: null }),
    maybeSingle: async () => ({ data: { id: "sandbox-new" }, error: null }),
  };
  const repoQuery = {
    select: () => repoQuery,
    eq: () => repoQuery,
    maybeSingle: async () => ({ data: { id: REPO_ID }, error: null }),
  };
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: (table: string) =>
      table === "sandboxes" ? sandboxQuery : repoQuery,
  });
}

/** Records what the output check was shown, and flags every result. */
function makeExecution(respond: (sandboxId: string) => Response) {
  const checked: Array<{ stdout?: string; scope: DecisionScope }> = [];
  return {
    checked,
    execution: {
      execute: async (sandboxId: string) => respond(sandboxId),
      checkOutput: async <T extends { stdout?: string }>(
        result: T,
        checkedScope: DecisionScope
      ) => {
        checked.push({ stdout: result.stdout, scope: checkedScope });
        return { ...result, outputCheck: "a step failed" };
      },
    },
  };
}

function run(execution: ReturnType<typeof makeExecution>["execution"]) {
  const tool = createTerminalExec(
    "sandbox-old",
    "user-1",
    REPO_ID,
    undefined,
    execution,
    scope
  ) as unknown as {
    execute: (input: { command: string }) => Promise<Record<string, unknown>>;
  };
  return tool.execute({ command: "set +e; ls /nope; echo finished" });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
});

afterAll(() => {
  if (originalSupabaseUrl === undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  if (originalServiceRoleKey === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
});

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "internal-secret";
  installRunningSandbox();
});

afterEach(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
  if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = originalSecret;
});

describe("the hidden-failure check on shell results", () => {
  it("should check a command that succeeded on the first attempt", async () => {
    const { execution, checked } = makeExecution(() =>
      Response.json(HIDDEN_FAILURE)
    );

    const result = await run(execution);

    expect(checked).toEqual([{ stdout: HIDDEN_FAILURE.stdout, scope }]);
    expect(result).toMatchObject({ outputCheck: "a step failed" });
  });

  it("should check a command that only succeeded after its sandbox was replaced", async () => {
    const { execution, checked } = makeExecution((sandboxId) =>
      sandboxId === "sandbox-old"
        ? Response.json({ error: "old sandbox missing" }, { status: 404 })
        : Response.json(HIDDEN_FAILURE)
    );

    const result = await run(execution);

    expect(checked).toEqual([{ stdout: HIDDEN_FAILURE.stdout, scope }]);
    expect(result).toMatchObject({
      sandboxId: "sandbox-new",
      outputCheck: "a step failed",
    });
  });

  it("should not run the check for a tool instance without a decision scope", async () => {
    const { execution, checked } = makeExecution(() =>
      Response.json(HIDDEN_FAILURE)
    );
    const tool = createTerminalExec(
      "sandbox-old",
      "user-1",
      REPO_ID,
      undefined,
      execution
    ) as unknown as {
      execute: (input: { command: string }) => Promise<Record<string, unknown>>;
    };

    const result = await tool.execute({ command: "echo finished" });

    expect(checked).toHaveLength(0);
    expect(result).not.toHaveProperty("outputCheck");
  });
});
