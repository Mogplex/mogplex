import { describe, expect, it } from "vitest";
import { HARNESSES } from "@/lib/harness/config";
import { runHarness } from "@/lib/harness/runner";
import {
  acpPermissionPolicy,
  codexAcpAuth,
  codexAcpEnv,
  codexAcpModeId,
  resolveHarnessAcpAgent,
} from "./agent";
import { ACP_BRIDGE_SCRIPT } from "./bridge-script";
import { ACP_BRIDGE_PATH } from "./launch";

const GATEWAY_ENV = {
  OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
  CODEX_API_KEY: "gateway-key-fixture",
};

type Call = {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  detached?: boolean;
};

function fakeSandbox(installed: boolean) {
  const calls: Call[] = [];
  const written = new Map<string, string>();
  const sandbox = {
    async readFile() {
      if (installed) return Buffer.from("1");
      throw new Error("missing");
    },
    async writeFiles(files: Array<{ path: string; content: Buffer }>) {
      for (const file of files) written.set(file.path, file.content.toString());
    },
    async runCommand(input: Call) {
      calls.push(input);
      if (input.detached) return { cmdId: "cmd_acp" };
      return { exitCode: 0, stdout: async () => "{}", stderr: async () => "" };
    },
  };
  return { sandbox, calls, written };
}

describe("resolveHarnessAcpAgent", () => {
  it("should drive Codex through its ACP agent unless switched off", () => {
    expect(resolveHarnessAcpAgent("codex", {})).toEqual(HARNESSES.codex.acp);
    expect(
      resolveHarnessAcpAgent("codex", { MOGPLEX_HARNESS_ACP: "off" })
    ).toBeNull();
    expect(
      resolveHarnessAcpAgent("codex", { MOGPLEX_HARNESS_ACP: "0" })
    ).toBeNull();
  });

  it("should keep a harness without an ACP pin on its CLI", () => {
    expect(resolveHarnessAcpAgent("claude-code", {})).toBeNull();
  });
});

describe("codexAcpEnv", () => {
  it("should pass the gateway model and worker isolation as config, never the key", () => {
    const env = codexAcpEnv(GATEWAY_ENV, "AUTO");

    expect(JSON.parse(env.CODEX_CONFIG)).toEqual({
      model: "openai/gpt-5.6-sol",
      features: { multi_agent: false },
    });
    expect(env.NO_BROWSER).toBe("1");
    expect(JSON.stringify(env)).not.toContain("gateway-key-fixture");
  });

  it("should keep Codex's own model for a direct OpenAI key", () => {
    expect(
      JSON.parse(codexAcpEnv({ CODEX_API_KEY: "sk-direct" }).CODEX_CONFIG)
    ).toEqual({
      features: { multi_agent: false },
    });
  });

  it("should map each execution mode to a codex-acp mode", () => {
    expect(codexAcpModeId("SAFE")).toBe("read-only");
    expect(codexAcpModeId("AUTO")).toBe("workspace-write");
    expect(codexAcpModeId()).toBe("workspace-write");
    expect(codexAcpModeId("YOLO")).toBe("agent-full-access");
    expect(codexAcpEnv(GATEWAY_ENV, "SAFE").INITIAL_AGENT_MODE).toBe(
      "read-only"
    );
  });
});

describe("codexAcpAuth", () => {
  it("should sign in to the Codex gateway endpoint for gateway-billed runs", () => {
    expect(codexAcpAuth(GATEWAY_ENV)).toEqual({
      type: "gateway",
      baseUrl: "https://ai-gateway.vercel.sh/codex/v1",
      providerName: "Mogplex AI Gateway",
      apiKeyEnv: "CODEX_API_KEY",
    });
  });

  it("should sign in to OpenAI, or the user's endpoint, for a direct key", () => {
    expect(codexAcpAuth({ CODEX_API_KEY: "sk-direct" }).baseUrl).toBe(
      "https://api.openai.com/v1"
    );
    expect(
      codexAcpAuth({
        CODEX_API_KEY: "k",
        OPENAI_BASE_URL: "https://llm.example.test/v1",
      }).baseUrl
    ).toBe("https://llm.example.test/v1");
  });
});

describe("acpPermissionPolicy", () => {
  it("should approve MCP tools in every mode and other requests only in YOLO", () => {
    expect(acpPermissionPolicy("SAFE")).toEqual({
      mcp: "allow",
      other: "decline",
    });
    expect(acpPermissionPolicy("AUTO")).toEqual({
      mcp: "allow",
      other: "decline",
    });
    expect(acpPermissionPolicy("YOLO")).toEqual({
      mcp: "allow",
      other: "allow",
    });
  });
});

describe("runHarness through ACP", () => {
  it("should install the ACP agent, write the bridge and run, and launch it isolated", async () => {
    const { sandbox, calls, written } = fakeSandbox(false);

    const result = await runHarness(
      sandbox as never,
      "codex",
      "Fix the bug",
      GATEWAY_ENV,
      {
        cwd: "apps/web",
        mode: "AUTO",
        resumeSessionId: " earlier-session ",
        mcpConfigPath: ".mogplex/mcp.json",
        runtimeEnv: { MOGPLEX_TEST_RUNTIME: "kept" },
        platformEnv: {},
      }
    );

    expect(result.installed).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.args?.[1] === "npm i -g @agentclientprotocol/codex-acp@2.0.0"
      )
    ).toBe(true);
    expect(written.get(ACP_BRIDGE_PATH)).toBe(ACP_BRIDGE_SCRIPT);

    const launch = calls.find((call) => call.detached);
    expect(launch?.cmd).toBe("setpriv");
    expect(launch?.args?.slice(0, 6)).toEqual([
      "--no-new-privs",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--",
      "node",
      ACP_BRIDGE_PATH,
    ]);
    expect(launch?.cwd).toBe("/vercel/sandbox/apps/web");
    expect(launch?.env).toMatchObject({
      CODEX_API_KEY: "gateway-key-fixture",
      MOGPLEX_TEST_RUNTIME: "kept",
      INITIAL_AGENT_MODE: "workspace-write",
    });

    const runPath = launch?.args?.[6] ?? "";
    expect(runPath).toMatch(
      /^\/vercel\/sandbox\/\.mogplex\/acp-run-[\da-f-]+\.json$/
    );
    const run = JSON.parse(written.get(runPath) ?? "{}");
    expect(run).toEqual({
      agent: { command: "codex-acp", args: [] },
      cwd: "/vercel/sandbox/apps/web",
      prompt: "Fix the bug",
      modeId: "workspace-write",
      resumeSessionId: "earlier-session",
      mcpConfigPath: "/vercel/sandbox/apps/web/.mogplex/mcp.json",
      permissions: { mcp: "allow", other: "decline" },
      auth: {
        type: "gateway",
        baseUrl: "https://ai-gateway.vercel.sh/codex/v1",
        providerName: "Mogplex AI Gateway",
        apiKeyEnv: "CODEX_API_KEY",
      },
    });
    // The prompt and key stay out of argv.
    expect(launch?.args?.join(" ")).not.toContain("Fix the bug");
    expect(launch?.args?.join(" ")).not.toContain("gateway-key-fixture");
  });

  it("should give each run its own config file", async () => {
    const { sandbox, calls } = fakeSandbox(true);

    await runHarness(sandbox as never, "codex", "one", GATEWAY_ENV, {
      platformEnv: {},
    });
    await runHarness(sandbox as never, "codex", "two", GATEWAY_ENV, {
      platformEnv: {},
    });

    const runPaths = calls
      .filter((call) => call.detached)
      .map((call) => call.args?.[6]);
    expect(new Set(runPaths).size).toBe(2);
  });

  it("should return to the Codex CLI when ACP is switched off", async () => {
    const { sandbox, calls } = fakeSandbox(false);

    await runHarness(sandbox as never, "codex", "Fix the bug", GATEWAY_ENV, {
      platformEnv: { MOGPLEX_HARNESS_ACP: "off" },
    });

    expect(
      calls.some((call) => call.args?.[1] === "npm i -g @openai/codex@0.146.1")
    ).toBe(true);
    const launch = calls.find((call) => call.detached);
    expect(launch?.args?.slice(-3)).toEqual(["exec", "--json", "Fix the bug"]);
  });
});
