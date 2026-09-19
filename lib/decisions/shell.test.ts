import { describe, expect, it } from "vitest";
import {
  annotateShellResult,
  checkCommandRisk,
  COMMAND_RISK_BLOCK_MESSAGE,
  isRemoteDestructiveCommand,
  OUTPUT_CHECK_NOTE,
  runWithCommandRiskCheck,
  type DecideFn,
} from "./shell";

const scope = { surface: "agent_tool", userId: "user-1" };

function fakeDecide(outcome: {
  act: boolean;
  mode: "shadow" | "advise" | "enforce";
}) {
  const calls: Array<{ id: string; state: unknown; options: unknown }> = [];
  const decideFn: DecideFn = async (id, state, _scope, options) => {
    calls.push({ id, state, options });
    return { ...outcome, verdict: outcome.act ? "flagged" : "clear" };
  };
  return { decideFn, calls };
}

describe("checkCommandRisk", () => {
  it("should block a flagged command only in enforce mode", async () => {
    const { decideFn, calls } = fakeDecide({ act: true, mode: "enforce" });

    const result = await checkCommandRisk("terraform destroy", scope, decideFn);

    expect(result).toEqual({
      error: COMMAND_RISK_BLOCK_MESSAGE,
      reason: "command_risk",
    });
    expect(calls[0]).toMatchObject({
      id: "command_risk",
      state: { command: "terraform destroy" },
      options: { baseline: { guardBlocked: false } },
    });
  });

  it("should let the command run when the mode only observes", async () => {
    const { decideFn } = fakeDecide({ act: false, mode: "shadow" });
    expect(
      await checkCommandRisk("terraform destroy", scope, decideFn)
    ).toBeNull();
  });

  it("should not block a flagged command in advise mode, where acting means a note", async () => {
    const { decideFn } = fakeDecide({ act: true, mode: "advise" });
    expect(
      await checkCommandRisk("terraform destroy", scope, decideFn)
    ).toBeNull();
  });

  it("should skip the check when another layer owns the risk gate", async () => {
    const { decideFn, calls } = fakeDecide({ act: true, mode: "enforce" });

    const result = await checkCommandRisk(
      "git push --force",
      { ...scope, riskGate: false },
      decideFn
    );

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("should not name the evaluation provider in the customer-facing message", () => {
    expect(COMMAND_RISK_BLOCK_MESSAGE).not.toMatch(/jev|typesafe|gateway/i);
  });
});

describe("runWithCommandRiskCheck", () => {
  const enforce = { DECISION_MODES: '{"command_risk":"enforce"}' };
  const shadow = { DECISION_MODES: '{"command_risk":"shadow"}' };

  function deferredDecide(outcome: {
    act: boolean;
    mode: "shadow" | "enforce";
  }) {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decideFn: DecideFn = async () => {
      order.push("judgment started");
      await gate;
      order.push("judgment recorded");
      return { ...outcome, verdict: "flagged" };
    };
    const run = async () => {
      order.push("command ran");
      return { exitCode: 0 };
    };
    return { decideFn, run, order, release };
  }

  it("should not run a flagged command in enforce mode", async () => {
    const { decideFn, run, order, release } = deferredDecide({
      act: true,
      mode: "enforce",
    });
    release();

    const result = await runWithCommandRiskCheck(
      "terraform destroy",
      scope,
      run,
      decideFn,
      enforce
    );

    expect(result).toEqual({
      error: COMMAND_RISK_BLOCK_MESSAGE,
      reason: "command_risk",
      command: "terraform destroy",
    });
    expect(order).not.toContain("command ran");
  });

  it("should wait for the judgment before running in enforce mode", async () => {
    const { decideFn, run, order, release } = deferredDecide({
      act: false,
      mode: "enforce",
    });

    const pending = runWithCommandRiskCheck(
      "pnpm test",
      scope,
      run,
      decideFn,
      enforce
    );
    await Promise.resolve();
    expect(order).toEqual(["judgment started"]);
    release();

    expect(await pending).toEqual({ exitCode: 0 });
    expect(order).toEqual([
      "judgment started",
      "judgment recorded",
      "command ran",
    ]);
  });

  it("should run the command without waiting when the mode only observes", async () => {
    const { decideFn, run, order, release } = deferredDecide({
      act: true,
      mode: "shadow",
    });

    const pending = runWithCommandRiskCheck(
      "terraform destroy",
      scope,
      run,
      decideFn,
      shadow
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["judgment started", "command ran"]);

    let returned = false;
    void pending.then(() => {
      returned = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(returned).toBe(false);

    release();
    expect(await pending).toEqual({ exitCode: 0 });
    expect(order.at(-1)).toBe("judgment recorded");
  });

  it("should return the command result when an observing judgment throws", async () => {
    const decideFn: DecideFn = async () => {
      throw new Error("evaluator down");
    };

    const result = await runWithCommandRiskCheck(
      "pnpm test",
      scope,
      async () => ({ exitCode: 0 }),
      decideFn,
      shadow
    );

    expect(result).toEqual({ exitCode: 0 });
  });
});

describe("isRemoteDestructiveCommand", () => {
  it("should report the decision's act flag", async () => {
    expect(
      await isRemoteDestructiveCommand(
        "git push -uf origin x",
        scope,
        fakeDecide({ act: true, mode: "enforce" }).decideFn
      )
    ).toBe(true);
    expect(
      await isRemoteDestructiveCommand(
        "git status",
        scope,
        fakeDecide({ act: false, mode: "enforce" }).decideFn
      )
    ).toBe(false);
  });

  it("should not evaluate an empty command", async () => {
    const { decideFn, calls } = fakeDecide({ act: true, mode: "enforce" });
    expect(await isRemoteDestructiveCommand("  ", scope, decideFn)).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("annotateShellResult", () => {
  const passing = {
    exitCode: 0,
    stdout: "pnpm lint exit: 1\n3 problems",
    stderr: "",
    command: "set +e; pnpm lint; echo done",
  };

  it("should add a note when a zero-exit command reads as failed", async () => {
    const { decideFn, calls } = fakeDecide({ act: true, mode: "advise" });

    const result = await annotateShellResult(passing, scope, decideFn);

    expect(result).toEqual({ ...passing, outputCheck: OUTPUT_CHECK_NOTE });
    expect(calls[0]).toMatchObject({
      id: "tool_result_failed",
      state: { command: passing.command, output: passing.stdout },
    });
  });

  it("should return the result untouched when nothing is flagged", async () => {
    const { decideFn } = fakeDecide({ act: false, mode: "advise" });
    expect(await annotateShellResult(passing, scope, decideFn)).toBe(passing);
  });

  it("should not evaluate results the model can already read as failed or empty", async () => {
    const { decideFn, calls } = fakeDecide({ act: true, mode: "advise" });
    const failed = { ...passing, exitCode: 2 };
    const silent = { exitCode: 0, stdout: "", stderr: "", command: "true" };
    const unknown = { ...passing, exitCode: null };

    expect(await annotateShellResult(failed, scope, decideFn)).toBe(failed);
    expect(await annotateShellResult(silent, scope, decideFn)).toBe(silent);
    expect(await annotateShellResult(unknown, scope, decideFn)).toBe(unknown);
    expect(calls).toHaveLength(0);
  });
});
