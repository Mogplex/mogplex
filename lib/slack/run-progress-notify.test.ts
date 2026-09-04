import { describe, expect, it } from "vitest";
import type { UpdateSlackMessageInput } from "@/lib/slack/client";
import { SLACK_RUN_CONTROLS_BLOCK_ID } from "@/lib/slack/run-controls";
import { createSlackRunProgressReporter } from "./run-progress-notify";

process.env.NEXT_PUBLIC_APP_URL ||= "https://mogplex.com";

function makeDeps() {
  const updates: UpdateSlackMessageInput[] = [];
  let clock = 0;
  return {
    updates,
    setClock: (value: number) => {
      clock = value;
    },
    deps: {
      getSlackBotToken: async () => "xoxb-test" as string | null,
      updateSlackMessage: async (
        _token: string,
        input: UpdateSlackMessageInput
      ) => {
        updates.push(input);
      },
      now: () => clock,
      minUpdateIntervalMs: 1000,
    },
  };
}

const runWithSlack = {
  id: "run-1",
  metadata: {
    slackRunControls: { teamId: "T1", channelId: "C1", messageTs: "123.45" },
  },
};

function cancelBlock(input: UpdateSlackMessageInput) {
  return (input.blocks ?? []).find(
    (block) => block.block_id === SLACK_RUN_CONTROLS_BLOCK_ID
  );
}

describe("createSlackRunProgressReporter", () => {
  it("should be a no-op for a run without Slack coordinates", async () => {
    const { updates, deps } = makeDeps();
    const reporter = createSlackRunProgressReporter(
      { id: "run-1", metadata: {} },
      deps
    );

    await reporter.report({ kind: "tool_started", toolName: "Read" });
    await reporter.flush();

    expect(updates).toHaveLength(0);
  });

  it("should throttle edits and keep the cancel button on each update", async () => {
    const { updates, deps, setClock } = makeDeps();
    const reporter = createSlackRunProgressReporter(runWithSlack, deps);

    await reporter.report({ kind: "tool_started", toolName: "Read" }); // t=0 posts
    setClock(500);
    await reporter.report({ kind: "tool_started", toolName: "Bash" }); // within interval
    setClock(1500);
    await reporter.report({ kind: "tool_started", toolName: "Edit" }); // posts
    await reporter.flush(); // nothing new pending

    expect(updates).toHaveLength(2);
    expect(updates[0]!.text).toContain("Reading a file");
    expect(updates[1]!.text).toContain("Running a command");
    expect(updates[1]!.text).toContain("Editing a file");
    expect(updates[0]!.channel).toBe("C1");
    expect(updates[0]!.ts).toBe("123.45");
    expect(cancelBlock(updates[0]!)).toBeDefined();
    expect(cancelBlock(updates[1]!)).toBeDefined();
  });

  it("should surface the latest assistant line and failed tools", async () => {
    const { updates, deps, setClock } = makeDeps();
    const reporter = createSlackRunProgressReporter(runWithSlack, deps);

    await reporter.report({
      kind: "assistant_text",
      text: "Investigating the mobile header\nmore detail",
    }); // t=0 posts
    setClock(2000);
    await reporter.report({
      kind: "tool_finished",
      toolName: "Bash",
      state: "error",
    }); // posts
    await reporter.flush();

    expect(updates.at(-1)!.text).toContain("> Investigating the mobile header");
    expect(updates.at(-1)!.text).toContain("Running a command (failed)");
  });

  it("should not post when no bot token is available", async () => {
    const { updates, deps } = makeDeps();
    const reporter = createSlackRunProgressReporter(runWithSlack, {
      ...deps,
      getSlackBotToken: async () => null,
    });

    await reporter.report({ kind: "tool_started", toolName: "Read" });
    await reporter.flush();

    expect(updates).toHaveLength(0);
  });

  it("should flush a pending update that was throttled", async () => {
    const { updates, deps, setClock } = makeDeps();
    const reporter = createSlackRunProgressReporter(runWithSlack, deps);

    await reporter.report({ kind: "tool_started", toolName: "Read" }); // t=0 posts
    setClock(200);
    await reporter.report({ kind: "tool_started", toolName: "Bash" }); // throttled
    await reporter.flush(); // forces the pending update out

    expect(updates).toHaveLength(2);
    expect(updates[1]!.text).toContain("Running a command");
  });
});
