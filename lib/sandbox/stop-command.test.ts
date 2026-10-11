import { expect, it } from "vitest";
import { stopSandboxCommand } from "./stop-command";

it("does not acknowledge Stop until the command has exited", async () => {
  const exit = Promise.withResolvers<{ exitCode: number }>();
  let complete = false;
  const stopped = stopSandboxCommand({
    exitCode: null,
    kill: async () => {},
    wait: () => exit.promise as never,
  }).then(() => {
    complete = true;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  exit.resolve({ exitCode: 143 });
  await stopped;
  expect(complete).toBe(true);
});

it("accepts duplicate termination only when exit is confirmed", async () => {
  await expect(
    stopSandboxCommand({
      exitCode: null,
      kill: async () => {
        throw new Error("Already stopped");
      },
      wait: async () => ({ exitCode: 143 }) as never,
    })
  ).resolves.toBeUndefined();
  await expect(
    stopSandboxCommand({
      exitCode: null,
      kill: async () => {
        throw new Error("Unavailable");
      },
      wait: async () => {
        throw new Error("Termination unconfirmed");
      },
    })
  ).rejects.toThrow("Termination unconfirmed");
});

it("leaves a completed command alone", async () => {
  await expect(
    stopSandboxCommand({
      exitCode: 0,
      kill: async () => {
        throw new Error("Must not signal a completed command");
      },
      wait: async () => ({ exitCode: 0 }) as never,
    })
  ).resolves.toBeUndefined();
});
