import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelectedControlSandboxId } from "../../app/api/control/chat/_lib/context";
import { ORCHESTRATOR_TOOLS } from "../../lib/agents/orchestrator/registry";
import { buildOrchestratorSystemPrompt } from "../../lib/agents/orchestrator/system-prompt";

test("plan mode adds explicit non-mutation intent to the orchestrator prompt", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    missionId: "mission-1",
    missionTitle: "Fix onboarding",
    controlMode: "plan",
    controlScope: "PLAN ONLY",
    controlTarget: "mission",
    controlPermissions: "Ask First",
  });

  assert.match(prompt, /<control-intent>/);
  assert.match(prompt, /Mode: plan/);
  assert.match(prompt, /Scope: PLAN ONLY/);
  assert.match(prompt, /Target: mission/);
  assert.match(prompt, /Permissions: Ask First/);
  assert.match(prompt, /planning only/);
  assert.match(prompt, /do not spawn workers or mutate repository files/);
  assert.doesNotMatch(prompt, /Use spawn_worktree/);
});

test("orchestrator prompt keeps sandboxes and worktrees distinct", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    activeSandboxes: [
      { id: "sandbox-record-1", branch: "feat/context", status: "running" },
    ],
  });

  assert.match(prompt, /Sandboxes and Git worktrees are separate resources/);
  assert.match(prompt, /sandbox_start.*runtime or preview/i);
  assert.match(prompt, /run_command.*selected sandbox/i);
  assert.match(prompt, /plan_mission.*task identities/i);
  assert.match(prompt, /spawn_worktree.*planned task/i);
  assert.match(prompt, /spawn_subagent.*active persisted worktree/i);
  assert.match(
    prompt,
    /Preview-only, inspection-only, and command-only work.*not.*worktree/i
  );
  assert.match(prompt, /Sandbox lifecycle.*never.*worktree lifecycle/i);
  assert.match(prompt, /Active worktrees:\n\(none\)/);
  assert.match(
    prompt,
    /sandbox-record-1: branch=feat\/context, status=running/
  );
});

test("no-sandbox context describes fallback without inventing a worktree", () => {
  const prompt = buildOrchestratorSystemPrompt({ repoFullName: "acme/demo" });
  assert.match(prompt, /No active sandbox is selected/);
  assert.match(prompt, /run_command.*exactly one repo-scoped running sandbox/i);
  assert.match(prompt, /never implies or creates a worktree/i);
});

test("prompt exposes callable tools but not planned capabilities", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    availableToolNames: ["sandbox_start", "run_command", "plan_mission"],
  });
  assert.match(prompt, /sandbox_start/);
  assert.match(prompt, /run_command/);
  assert.match(prompt, /plan_mission/);
  for (const planned of ORCHESTRATOR_TOOLS.filter(
    (tool) => !tool.implemented
  )) {
    const toolNamePattern = new RegExp(`\\b${planned.name}\\b`);
    assert.equal(
      toolNamePattern.test(prompt),
      false,
      `planned tool leaked into model prompt: ${planned.name}`
    );
  }
});

test("one sandbox is selected without inventing a worktree", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    activeSandboxes: [
      { id: "sandbox-record-1", branch: "main", status: "running" },
    ],
  });
  assert.match(prompt, /Selected sandbox: sandbox-record-1/);
  assert.match(prompt, /Active worktrees:\n\(none\)/);
});

test("multiple sandboxes require explicit selection", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    sandboxSelectionRequired: true,
    activeSandboxes: [
      { id: "sandbox-record-1", branch: "main", status: "running" },
      { id: "sandbox-record-2", branch: "feat/a", status: "running" },
    ],
  });
  assert.match(prompt, /No sandbox is selected/);
  assert.match(prompt, /must explicitly select one of the listed sandbox IDs/i);
  assert.match(prompt, /Never guess/i);
  assert.match(prompt, /SANDBOX SELECTION IS REQUIRED/);
  assert.match(prompt, /then stop with no tool call/i);
  assert.match(prompt, /server-validated execution boundary/i);
  assert.doesNotMatch(prompt, /Selected sandbox:/);
});

test("parallel worktrees retain distinct task checkout identities", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    activeWorktrees: [
      {
        id: "worktree-1",
        taskId: "task-1",
        branch: "feat/a",
        status: "active",
        sandboxId: "sandbox-record-1",
        checkoutPath: "/repo/.worktrees/worktree-1",
      },
      {
        id: "worktree-2",
        taskId: "task-2",
        branch: "feat/b",
        status: "active",
        sandboxId: "sandbox-record-1",
        checkoutPath: "/repo/.worktrees/worktree-2",
      },
    ],
  });
  assert.match(prompt, /worktree-1: task=task-1, branch=feat\/a/);
  assert.match(prompt, /checkout=\/repo\/\.worktrees\/worktree-1/);
  assert.match(prompt, /worktree-2: task=task-2, branch=feat\/b/);
  assert.match(prompt, /checkout=\/repo\/\.worktrees\/worktree-2/);
});

test("one worktree identifies its exact sandbox and checkout", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    activeWorktrees: [
      {
        id: "worktree-1",
        taskId: "task-1",
        branch: "feat/context",
        status: "active",
        sandboxId: "sandbox-record-1",
        checkoutPath: "/vercel/sandbox/.worktrees/worktree-1",
      },
    ],
  });
  assert.match(
    prompt,
    /worktree-1: task=task-1, branch=feat\/context, status=active, sandbox=sandbox-record-1, checkout=\/vercel\/sandbox\/\.worktrees\/worktree-1/
  );
});

test("only one server-validated sandbox can become tool context", () => {
  assert.equal(resolveSelectedControlSandboxId([]), null);
  assert.equal(
    resolveSelectedControlSandboxId([{ id: "sandbox-record-1" }]),
    "sandbox-record-1"
  );
  assert.equal(
    resolveSelectedControlSandboxId([
      { id: "sandbox-record-1" },
      { id: "sandbox-record-2" },
    ]),
    null
  );
});
