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
import type { SkillSelectionInput } from "../../lib/decisions/skills";
import type { CatalogSkill, SkillCatalog } from "../../lib/skill-catalog/types";

function skill(
  id: string,
  slug: string,
  name: string,
  content: string
): CatalogSkill {
  return {
    id,
    slug,
    name,
    description: null,
    content,
    tags: [],
    source: "library",
  };
}

const deploy = skill(
  "s1",
  "deploy-checklist",
  "Deploy checklist",
  "1. Run the tests."
);
const notes = skill(
  "s2",
  "release-notes",
  "Release notes",
  "Group changes by area."
);
const compact = skill("s3", "compact", "Compact", "Summarize tersely.");

const reviewer: AgentRuntime = {
  id: "agent-1",
  name: "REVIEWER",
  slug: "reviewer",
  model: null,
  systemPrompt: "Review carefully.",
  skills: [
    {
      id: "s2",
      name: "Release notes",
      description: null,
      content: "Group changes by area.",
    },
  ],
  rules: [],
  preset: false,
  teamId: null,
  ownerUserId: "user-123",
};

type Write = { path: string; content: string };
type LoggedEvent = { message?: string; payload?: Record<string, unknown> };

async function runHarness(input: {
  prompt: string;
  harness?: "codex" | "claude-code";
  agentId?: string;
  loadSkillCatalog: (args: {
    userId: string;
    repoId?: string | null;
  }) => Promise<SkillCatalog>;
}) {
  const { createSandboxHarnessPostHandler } =
    await loadSandboxHarnessRouteModule();
  const aiCall = buildAiCall();
  const writes: Write[] = [];
  const events: LoggedEvent[] = [];
  const used: string[][] = [];
  const checks: SkillSelectionInput[] = [];
  const deferred: Array<() => Promise<void>> = [];
  let harnessPrompt = "";
  const handler = createSandboxHarnessPostHandler({
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
          for (const file of files) {
            writes.push({ path: file.path, content: file.content.toString() });
          }
        },
      }) as never,
    runHarness: async (
      _sandbox: unknown,
      _harness: unknown,
      prompt: string
    ) => {
      harnessPrompt = prompt;
      return {
        installed: false,
        installLogs: "",
        command: {
          cmdId: "cmd-skills",
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
    updateAiCall: async () => {},
    finalizeAiCallIfNotCancelled: async () =>
      buildAiCall({ status: "success" }),
    safeAppendAiCallEvent: async (event: LoggedEvent) => {
      events.push(event);
      return null;
    },
    loadHarnessPromptWithMemoryContext: async (_userId: string, text: string) =>
      text,
    persistHarnessMemory: async () => {},
    resolveAgentRuntime: async () => reviewer,
    observeSkillSelection: async (check: SkillSelectionInput) => {
      checks.push(check);
    },
    runAfterResponse: (work: () => Promise<void>) => {
      deferred.push(work);
    },
    loadSkillCatalog: input.loadSkillCatalog,
    recordSkillUse: async (_userId: string, skills: Array<{ id: string }>) => {
      used.push(skills.map((skill) => skill.id));
    },
  } as never);

  const response = await handler(
    buildSandboxRouteRequest({
      method: "POST",
      suffix: "/harness",
      init: {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness: input.harness ?? "codex",
          prompt: input.prompt,
          ...(input.agentId ? { agentId: input.agentId } : {}),
        }),
      },
    }),
    buildSandboxRouteParams()
  );
  const body = await response.text();
  return {
    status: response.status,
    body,
    writes,
    events,
    used,
    checks,
    deferred,
    harnessPrompt,
  };
}

function skillWrites(writes: Write[]) {
  return writes
    .filter((file) => file.path.includes(".mogplex/skills/"))
    .map((file) => file.path.slice(file.path.indexOf(".mogplex/")));
}

test("POST /api/sandbox/[id]/harness writes an invoked skill and the index ahead of the task", async () => {
  const catalogCalls: unknown[] = [];
  const run = await runHarness({
    prompt: "/deploy-checklist ship the staging branch",
    loadSkillCatalog: async (args) => {
      catalogCalls.push(args);
      return { skills: [deploy, notes] };
    },
  });

  assert.equal(run.status, 200);
  assert.equal(catalogCalls.length, 1);
  assert.equal((catalogCalls[0] as { userId: string }).userId, "user-123");
  assert.deepEqual(skillWrites(run.writes), [
    ".mogplex/skills/deploy-checklist/SKILL.md",
    ".mogplex/skills/release-notes/SKILL.md",
  ]);
  assert.ok(
    run.writes.some((file) => file.path.endsWith(".mogplex/.gitignore")),
    "skill files are kept out of git"
  );
  const prompt = run.harnessPrompt;
  assert.ok(prompt.includes("## Invoked skills"));
  assert.ok(
    prompt.includes(
      "- Deploy checklist (.mogplex/skills/deploy-checklist/SKILL.md)"
    )
  );
  assert.ok(prompt.includes("- $release-notes: Release notes"));
  assert.ok(
    !prompt.includes("1. Run the tests."),
    "a file surface names the skill; it does not inline it"
  );
  assert.ok(
    prompt.indexOf("</skills>") < prompt.indexOf("/deploy-checklist ship"),
    "the task follows the skills block, as the user typed it"
  );
  const logged = run.events.find(
    (event) => event.payload?.stage === "skill_catalog"
  );
  assert.deepEqual(logged?.payload?.invoked, ["deploy-checklist"]);
  assert.equal(logged?.message, "Invoked skills: Deploy checklist");
  assert.deepEqual(run.used, [["s1"]], "only the invoked skill counts as used");
  // One shadow check covers the catalog, and it is kept alive, not awaited.
  assert.equal(run.checks.length, 1);
  assert.equal(run.checks[0]?.agent, null);
  assert.deepEqual(run.checks[0]?.catalog?.invokedIds, ["s1"]);
  assert.deepEqual(
    run.checks[0]?.catalog?.skills.map((entry) => entry.name),
    ["Deploy checklist", "Release notes"]
  );
  assert.equal(
    run.checks[0]?.request,
    "/deploy-checklist ship the staging branch"
  );
  assert.equal(run.checks[0]?.scope.surface, "harness");
  assert.equal(run.deferred.length, 1);
});

test("POST /api/sandbox/[id]/harness leaves the CLI's own slash commands alone but honors $slug", async () => {
  const reserved = await runHarness({
    prompt: "/compact the history",
    loadSkillCatalog: async () => ({ skills: [compact] }),
  });
  assert.ok(!reserved.harnessPrompt.includes("## Invoked skills"));
  assert.ok(reserved.harnessPrompt.includes("- $compact: Compact"));

  const dollar = await runHarness({
    prompt: "use $compact on the history",
    loadSkillCatalog: async () => ({ skills: [compact] }),
  });
  assert.ok(dollar.harnessPrompt.includes("## Invoked skills"));
  assert.ok(
    dollar.harnessPrompt.includes(
      "- Compact (.mogplex/skills/compact/SKILL.md)"
    )
  );
});

test("POST /api/sandbox/[id]/harness puts the agent first and does not index a skill the agent already carries", async () => {
  const run = await runHarness({
    prompt: "Summarize $deploy-checklist for the team.",
    agentId: "agent-1",
    loadSkillCatalog: async () => ({ skills: [deploy, notes] }),
  });
  const prompt = run.harnessPrompt;
  assert.ok(
    prompt.indexOf("</agent>") < prompt.indexOf("<skills>"),
    "who the agent is comes before the skills in play"
  );
  assert.ok(prompt.indexOf("</skills>") < prompt.indexOf("Summarize $deploy"));
  assert.ok(
    !prompt.includes("- $release-notes:"),
    "already in the agent block"
  );
  assert.ok(prompt.includes(".mogplex/agent/skills/release-notes/SKILL.md"));
  assert.deepEqual(skillWrites(run.writes), [
    ".mogplex/skills/deploy-checklist/SKILL.md",
  ]);
  // The agent's skills and the catalog are judged together, once.
  assert.equal(run.checks.length, 1);
  assert.equal(run.checks[0]?.agent?.id, "agent-1");
  assert.deepEqual(
    run.checks[0]?.catalog?.skills.map((entry) => entry.name),
    ["Deploy checklist"]
  );
  assert.equal(
    run.checks[0]?.request,
    "Summarize $deploy-checklist for the team."
  );
});

test("POST /api/sandbox/[id]/harness runs unchanged for a user without skills or when the catalog fails", async () => {
  const none = await runHarness({
    prompt: "Fix $deploy-checklist typo",
    loadSkillCatalog: async () => ({ skills: [] }),
  });
  assert.equal(none.status, 200);
  assert.ok(!none.harnessPrompt.includes("<skills>"));
  assert.deepEqual(skillWrites(none.writes), []);
  assert.equal(none.checks.length, 0, "nothing in play, nothing to ask");

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const failed = await runHarness({
      prompt: "Fix $deploy-checklist typo",
      loadSkillCatalog: async () => {
        throw new Error("database offline");
      },
    });
    assert.equal(failed.status, 200);
    assert.ok(failed.harnessPrompt.includes("Fix $deploy-checklist typo"));
    assert.ok(!failed.harnessPrompt.includes("<skills>"));
  } finally {
    console.warn = originalWarn;
  }
});
