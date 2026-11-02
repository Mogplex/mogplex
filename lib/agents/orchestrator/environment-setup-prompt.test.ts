import { describe, expect, it } from "vitest";
import { buildOrchestratorTools } from "./registry";
import { buildOrchestratorSystemPrompt } from "./system-prompt";

describe("orchestrator environment setup prompt", () => {
  it("should tell Control to set up a project when sandbox_start reports a setup issue", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: ["sandbox_start", "run_command"],
    });

    expect(prompt).toContain("<environment_setup>");
    expect(prompt).toContain("whatever its language or layout");
    expect(prompt).toContain("Never ask for secret values in chat");
    expect(prompt).toContain("or sandbox_start reported a setupIssue");
    expect(prompt).toContain(
      "The operator's own project environment variables are not infrastructure"
    );
  });

  it("should have Control request secrets through project_env_request when it is callable", () => {
    const withTool = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: ["sandbox_start", "project_env_request"],
    });
    const withoutTool = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: ["sandbox_start"],
    });

    expect(withTool).toContain("call project_env_request with the names");
    expect(withoutTool).not.toContain("project_env_request");
    expect(withoutTool).toContain("Project settings > Environment variables");
  });

  it("should only mention project_env_set when that tool is callable", () => {
    const prompt = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: [
        "sandbox_start",
        "run_command",
        "project_settings",
        "project_settings_update",
      ],
    });

    expect(prompt).toContain("save them with project_settings_update");
    expect(prompt).not.toContain("project_env_set");
  });

  it("should have Control save working setup when the project tools are callable", () => {
    const withTools = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: [
        "sandbox_start",
        "run_command",
        "project_settings",
        "project_settings_update",
        "project_env_set",
      ],
    });
    const withoutTools = buildOrchestratorSystemPrompt({
      repoFullName: "acme/demo",
      availableToolNames: ["sandbox_start", "run_command"],
    });

    expect(withTools).toContain("save them with project_settings_update");
    expect(withTools).toContain("with project_env_set");
    expect(withoutTools).not.toContain("project_settings_update");
    expect(withoutTools).toContain("Project settings > General");
  });

  it("should leave the setup block out when Control cannot start compute", () => {
    for (const ctx of [
      { repoFullName: "acme/demo", availableToolNames: ["run_command"] },
      { repoFullName: "acme/demo", controlMode: "plan" as const },
    ]) {
      expect(buildOrchestratorSystemPrompt(ctx)).not.toContain(
        "When sandbox_start returns setupIssue"
      );
    }
  });
});

describe("orchestrator project settings tools", () => {
  it("should offer project settings tools only for a selected repository", () => {
    const names = [
      "project_settings",
      "project_settings_update",
      "project_env_set",
    ];
    const withRepo = buildOrchestratorTools({
      userId: "user-1",
      repoId: "00000000-0000-4000-8000-000000000001",
    });
    const withoutRepo = buildOrchestratorTools({ userId: "user-1" });

    for (const name of names) {
      expect(withRepo).toHaveProperty(name);
      expect(withoutRepo).not.toHaveProperty(name);
    }
  });
});
