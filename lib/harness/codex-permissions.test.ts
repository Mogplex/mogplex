import { expect, it } from "vitest";
import { HARNESSES } from "./config";

it.each([
  [undefined, "workspace-write"],
  ["AUTO", "workspace-write"],
  ["SAFE", "read-only"],
  ["YOLO", "danger-full-access"],
] as const)(
  "Codex honors %s mode for new and resumed workers",
  (mode, sandbox) => {
    for (const resumeSessionId of [undefined, "worker-session"]) {
      const command = HARNESSES.codex.buildCommand("Do the authorized task", {
        mode,
        resumeSessionId,
      });
      expect(command.args).toContain(`sandbox_mode="${sandbox}"`);
      expect(command.args).toContain('approval_policy="never"');
      expect(command.args).not.toContain(
        "--dangerously-bypass-approvals-and-sandbox"
      );
      expect(command.args.slice(command.args.indexOf("exec"))).toEqual(
        resumeSessionId
          ? [
              "exec",
              "resume",
              "--json",
              resumeSessionId,
              "Do the authorized task",
            ]
          : ["exec", "--json", "Do the authorized task"]
      );
    }
  }
);
