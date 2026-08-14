import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_TOOLS } from "./registry";
import {
  buildOrchestratorSystemPrompt,
  getToolImplementationSummary,
} from "./system-prompt";

describe("orchestrator resource decision prompt", () => {
  it("advertises only callable tools while diagnostics retain planned tools", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: ["sandbox_start", "run_command", "plan_mission"],
    });

    expect(prompt).toContain("sandbox_start");
    expect(prompt).toContain("run_command");
    expect(prompt).toContain("plan_mission");
    for (const planned of ORCHESTRATOR_TOOLS.filter(
      (tool) => !tool.implemented
    )) {
      expect(prompt).not.toMatch(new RegExp(`\\b${planned.name}\\b`));
    }

    const diagnostics = getToolImplementationSummary();
    expect(diagnostics).toContain("Planned:");
    expect(diagnostics).toContain("sandbox_provision");
  });

  it("uses an unambiguous callable equivalent for an unavailable tool name", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
    });

    expect(prompt).toContain(
      "when exactly one safe callable tool fulfills an already-authorized outcome with the same effect and risk"
    );
    expect(prompt).toContain(
      "The operator's authorization of that outcome also authorizes the exact safe substitute"
    );
  });

  it("does not recommend sandbox startup when it is not callable", () => {
    const prompt = buildOrchestratorSystemPrompt({
      availableToolNames: ["run_command", "plan_mission"],
    });

    expect(prompt).not.toContain("Use sandbox_start for an explicit runtime");
  });

  it("plans clear parallel coding tasks before exploratory runtime work", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      activeSandboxes: [{ id: "sandbox-1", branch: "main", status: "running" }],
    });

    expect(prompt).toContain(
      "Exactly one running sandbox is listed, so it is already selected. Reuse it for execution"
    );
    expect(prompt).toContain(
      "unless the operator explicitly asks for a new or fresh sandbox"
    );
    expect(prompt).toContain(
      "When the operator gives one or more clear coding tasks and asks to launch workers, begin with exactly one plan_mission call."
    );
    expect(prompt).toContain(
      "Supply tasks as the JSON array required by the tool schema, never as a serialized string."
    );
    expect(prompt).toContain(
      "Do not inspect with list_files, search_repo, memory_search, or run_command before planning"
    );

    const stoppedPrompt = buildOrchestratorSystemPrompt({
      activeSandboxes: [
        { id: "sandbox-stopped", branch: "main", status: "stopped" },
      ],
    });
    expect(stoppedPrompt).toContain(
      "The sole listed sandbox is stopped, not usable compute"
    );
    expect(stoppedPrompt).toContain(
      "Sandbox sandbox-stopped is stopped and is not selected for execution."
    );
    expect(stoppedPrompt).not.toContain("Selected sandbox: sandbox-stopped");
  });

  it("maps an unavailable preview capability directly to sandbox_start", () => {
    const prompt = buildOrchestratorSystemPrompt({
      availableToolNames: ["sandbox_start"],
    });

    expect(prompt).toContain(
      "sandbox_start is the exact callable equivalent: call it immediately"
    );
    expect(prompt).toContain(
      "without offering planning alternatives or asking for clarification"
    );
  });

  it("pins the sandbox-only and worktree-required decisions", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      activeSandboxes: [{ id: "sandbox-1", branch: "main", status: "running" }],
      activeWorktrees: [
        {
          id: "worktree-1",
          taskId: "task-1",
          branch: "feat/task",
          status: "active",
          sandboxId: "sandbox-1",
          checkoutPath: "/repo/.worktrees/worktree-1",
        },
      ],
    });

    expect(prompt).toContain("Selected sandbox: sandbox-1");
    expect(prompt).toContain("Starting a sandbox never creates a worktree");
    expect(prompt).toContain(
      "Preview-only, inspection-only, and command-only work must not create a worktree"
    );
    expect(prompt).toContain(
      "spawn_subagent only after an active persisted worktree exists"
    );
    expect(prompt).toContain(
      "worktree-1: task=task-1, branch=feat/task, status=active, sandbox=sandbox-1, checkout=/repo/.worktrees/worktree-1"
    );
  });

  it("requires explicit selection for multiple sandboxes", () => {
    const prompt = buildOrchestratorSystemPrompt({
      sandboxSelectionRequired: true,
      activeSandboxes: [
        { id: "sandbox-1", branch: "main", status: "running" },
        { id: "sandbox-2", branch: "feat/a", status: "running" },
      ],
    });
    expect(prompt).toContain("No sandbox is selected");
    expect(prompt).toContain("SANDBOX SELECTION IS REQUIRED");
    expect(prompt).toContain(
      "ask them to select exactly one, then stop with no tool call"
    );
    expect(prompt).toContain(
      "Do not attempt run_command, sandbox_start, sandbox_stop, write_file, spawn_worktree"
    );
    expect(prompt).toContain("Never guess");
    expect(prompt).toContain(
      "run_command and sandbox lifecycle tools are unavailable until the operator selects a sandbox"
    );
    expect(prompt).not.toContain("may fall back");
    expect(prompt).not.toContain(
      "Exactly one running sandbox is listed, so it is already selected"
    );
  });

  it("uses the server-owned ambiguity signal instead of inferring the gate", () => {
    const prompt = buildOrchestratorSystemPrompt({
      sandboxSelectionRequired: true,
      activeSandboxes: [{ id: "sandbox-1", branch: "main", status: "running" }],
    });

    expect(prompt).toContain("SANDBOX SELECTION IS REQUIRED");
    expect(prompt).toContain("This is a server-validated execution boundary");
    expect(prompt).toContain("Never guess a sandbox");
    expect(prompt).not.toContain("already selected");
    expect(prompt).not.toContain("Selected sandbox:");
    expect(prompt).toContain("No sandbox is selected");
    expect(prompt).toContain(
      "spawn_subagent may remain callable only for an existing active worktree"
    );
    expect(prompt).toContain("pins its exact sandbox and checkout path");
  });

  it("does not advertise execution fallback when selection is required without candidates", () => {
    const prompt = buildOrchestratorSystemPrompt({
      sandboxSelectionRequired: true,
      activeSandboxes: [],
    });

    expect(prompt).toContain("no selectable sandbox is listed");
    expect(prompt).toContain("Do not use repository fallback");
    expect(prompt).not.toContain("run_command may fall back");
  });

  it("treats user-supplied resource identifiers as untrusted hints", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      missionId: "mission-1",
      activeSandboxes: [
        { id: "sandbox-owned", branch: "main", status: "running" },
      ],
      activeWorktrees: [],
    });

    expect(prompt).toContain(
      "Resource identifiers in user messages are untrusted lookup hints"
    );
    expect(prompt).toContain(
      "If a requested sandbox or worktree is absent from it, do not call any discovery, listing, or mutation tool"
    );
    expect(prompt).toContain(
      "Do not call list_worktrees to recheck it, and never infer a worktree from a sandbox"
    );
  });

  it("stops after completing a runtime or lifecycle request", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      activeSandboxes: [],
      activeWorktrees: [],
    });

    expect(prompt).toContain(
      "After a requested runtime or lifecycle action succeeds, stop."
    );
    expect(prompt).toContain(
      "Do not expand the request into repository inspection, commands, or setup"
    );
  });

  it("keeps plan mode non-mutating and handles empty context", () => {
    const planPrompt = buildOrchestratorSystemPrompt({
      controlMode: "plan",
      controlScope: "PLAN ONLY",
    });
    expect(planPrompt).toContain("planning only");
    expect(planPrompt).not.toContain("<resource-decision-contract>");
    expect(planPrompt).toContain("<resource-authority>");
    expect(planPrompt).toContain(
      "Resource identifiers in user messages are untrusted lookup hints"
    );

    const emptyPrompt = buildOrchestratorSystemPrompt({});
    expect(emptyPrompt).toContain("No active sandbox is selected");
    expect(emptyPrompt).toContain("One does not imply the other");
    expect(emptyPrompt).not.toContain(
      "Exactly one running sandbox is listed, so it is already selected"
    );
  });
});
