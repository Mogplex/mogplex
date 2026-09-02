import { describe, expect, it } from "vitest";
import type { Tool } from "ai";
import { selectChatTools } from "./chat-surface-tools";

const fakeTool = { description: "fake" } as unknown as Tool;
const tools = {
  bash: fakeTool,
  start_sandbox: fakeTool,
  stop_sandbox: fakeTool,
  write_file: fakeTool,
  read_file: fakeTool,
  github_create_pull_request: fakeTool,
};

describe("selectChatTools", () => {
  it("should keep every tool on the chat surface", () => {
    expect(
      Object.keys(selectChatTools({ tools, surface: "chat" })).sort()
    ).toEqual(Object.keys(tools).sort());
  });

  it("should hide sandbox tools on the Slack surface", () => {
    expect(
      Object.keys(selectChatTools({ tools, surface: "slack" })).sort()
    ).toEqual(["github_create_pull_request", "read_file"]);
  });

  it("should merge additional tools after filtering", () => {
    const selected = selectChatTools({
      tools,
      surface: "slack",
      additionalTools: { start_repo_agent_run: fakeTool },
    });
    expect(selected.start_repo_agent_run).toBe(fakeTool);
    expect(selected.bash).toBeUndefined();
  });
});
