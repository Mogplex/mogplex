import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
} from "./sandbox-record-route-test-harness";
import {
  buildSandboxServiceAiAccess,
  buildOwnedSandboxServiceRecord,
  buildSandboxServiceRecordRepo,
  buildSandboxServiceRouteAuth,
} from "./sandbox-service-route-test-harness";
import {
  buildAiCall,
  buildHarnessGitDeliveryDeps,
  loadSandboxHarnessRouteModule,
} from "./helpers/sandbox-harness-route-fixtures";
import type { AgentRuntime } from "../../lib/agents/runtime/types";

const reviewer: AgentRuntime = {
  id: "agent-1",
  name: "NEXTJS-REVIEWER",
  slug: "nextjs-reviewer",
  model: null,
  systemPrompt: "Review App Router code carefully.",
  skills: [
    {
      id: "skill-1",
      name: "RSC Audit",
      description: "Find client boundaries",
      content: "# RSC Audit\n\nLook for use client.",
    },
  ],
  rules: [{ id: "rule-1", name: "No any", content: "Never use any." }],
  preset: false,
  teamId: null,
  ownerUserId: "user-123",
};

function buildDeps(input: {
  resolve: (args: {
    agentId: string;
    userId: string;
  }) => Promise<AgentRuntime | null>;
  onPrompt?: (prompt: string) => void;
  onWrite?: (files: Array<{ path: string; content: Buffer }>) => void;
}) {
  const aiCall = buildAiCall();
  return {
    ...buildHarnessGitDeliveryDeps(),
    getSandboxServiceCredentials: async () => buildSandboxServiceRouteAuth(),
    loadOwnedSandboxRecord: async () =>
      buildOwnedSandboxServiceRecord({
        repo: buildSandboxServiceRecordRepo({ github_installation_id: 123 }),
      }),
    resolveSandboxAiAccess: async () =>
      buildSandboxServiceAiAccess({
        aiBillingSource: "user_ai_gateway",
        gatewayApiKey: "gateway-key",
      }),
    getSandbox: async () =>
      ({
        readFile: async () => null,
        writeFiles: async (files: Array<{ path: string; content: Buffer }>) => {
          input.onWrite?.(files);
        },
      }) as never,
    runHarness: async (
      _sandbox: unknown,
      _harness: unknown,
      prompt: string
    ) => {
      input.onPrompt?.(prompt);
      return {
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-agent",
          async *logs() {
            yield { stream: "stdout" as const, data: "done\n" };
          },
          wait: async () => ({ exitCode: 0 }),
          kill: async () => {},
        },
      } as never;
    },
    renewSandboxActivityLease: async () => 0,
    stopSandboxRecord: async () => null,
    touchSandboxLastActive: async () => {},
    resolveRepoSandboxEnv: async () => ({
      envVars: {},
      sync: {
        mode: "sandbox-only" as const,
        source: "manual" as const,
        warning: null,
      },
    }),
    createAiCall: async () => aiCall,
    loadOwnedAiCall: async () => aiCall,
    mergeAiCallMetadata: async () => {
      throw new Error("mergeAiCallMetadata should not be called");
    },
    updateAiCall: async () => {},
    finalizeAiCallAsCancelledIfActive: async () => {
      throw new Error("cancel finalization should not be called");
    },
    finalizeAiCallIfNotCancelled: async (
      _aiCallId: string,
      update: { status?: string; error?: string | null }
    ) =>
      buildAiCall({
        status: (update.status as "success") ?? "success",
        error: update.error ?? null,
      }),
    safeAppendAiCallEvent: async () => null,
    loadHarnessPromptWithMemoryContext: async (_userId: string, text: string) =>
      text,
    persistHarnessMemory: async () => {},
    resolveAgentRuntime: input.resolve,
  };
}

test("POST /api/sandbox/[id]/harness materializes the agent's skills and leads the prompt with its block", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const writes: Array<{ path: string; content: string }> = [];
  let harnessPrompt = "";
  const handler = createSandboxHarnessPostHandler(
    buildDeps({
      resolve: async (args) => {
        assert.deepEqual(args, { agentId: "agent-1", userId: "user-123" });
        return reviewer;
      },
      onPrompt: (prompt) => {
        harnessPrompt = prompt;
      },
      onWrite: (files) => {
        for (const file of files) {
          writes.push({ path: file.path, content: file.content.toString() });
        }
      },
    })
  );

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness: "codex",
          prompt: "Review the router.",
          agentId: "agent-1",
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 200);
  await response.text();

  const skillFile = writes.find((file) =>
    file.path.endsWith(".mogplex/agent/skills/rsc-audit/SKILL.md")
  );
  assert.ok(skillFile, "skill file written into the checkout");
  assert.equal(skillFile.content, "# RSC Audit\n\nLook for use client.\n");
  assert.ok(
    writes.some((file) => file.path.endsWith(".mogplex/.gitignore")),
    "agent files are kept out of git"
  );

  const agentIndex = harnessPrompt.indexOf('<agent name="NEXTJS-REVIEWER">');
  assert.ok(agentIndex !== -1, "agent block present");
  assert.ok(
    harnessPrompt.indexOf("</delivery-contract>") < agentIndex,
    "the delivery contract still frames the whole run"
  );
  assert.ok(harnessPrompt.includes("Review App Router code carefully."));
  assert.ok(harnessPrompt.includes("### No any\nNever use any."));
  assert.ok(harnessPrompt.includes(".mogplex/agent/skills/rsc-audit/SKILL.md"));
  assert.ok(
    harnessPrompt.indexOf("</agent>") <
      harnessPrompt.indexOf("Review the router."),
    "the task follows the agent block"
  );
});

test("POST /api/sandbox/[id]/harness refuses an agent the caller cannot run before touching the sandbox", async () => {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  let harnessRan = false;
  const handler = createSandboxHarnessPostHandler(
    buildDeps({
      resolve: async () => null,
      onPrompt: () => {
        harnessRan = true;
      },
    })
  );

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness: "codex",
          prompt: "Review the router.",
          agentId: "not-mine",
        }),
      },
    }),
    buildSandboxRouteParams()
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Agent not found" });
  assert.equal(harnessRan, false);
});
