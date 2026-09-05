import { expect, test } from "vitest";
import { installTerminalBridgeOnce } from "./terminal-bridge-install";

test("bridge startup is exact-process cleanup, readiness first, then one health check", async () => {
  const commands: string[] = [];
  const result = await installTerminalBridgeOnce(
    {
      name: "provider-boundary",
      writeFiles: async () => {},
      runCommand: async ({ args }) => {
        const script = args.at(-1) ?? "";
        commands.push(script);
        const pattern = script.match(/pkill -f '([^']+)'/)?.[1];
        if (pattern) {
          const matcher = new RegExp(pattern);
          expect(matcher.test(`sh -lc ${script}`)).toBe(false);
          expect(
            matcher.test("node /vercel/sandbox/.mogplex/terminal-bridge.mjs")
          ).toBe(true);
          expect(
            matcher.test(
              "/usr/bin/node /vercel/sandbox/.mogplex/terminal-bridge.mjs"
            )
          ).toBe(true);
          expect(matcher.test("node /vercel/sandbox/other.mjs")).toBe(false);
        }
        return {
          exitCode: 0,
          stdout: async () =>
            script.includes("/health")
              ? '{"ok":true}'
              : "MOGPLEX_TERMINAL_BRIDGE_READY",
        };
      },
    },
    { source: "/* provider fixture */" }
  );
  expect(result.sandboxRuntimeId).toBe("provider-boundary");
  expect(commands).toHaveLength(2);
});

test.each([0, 143, undefined])(
  "startup without readiness fails immediately for exit %s",
  async (exitCode) => {
    let calls = 0;
    await expect(
      installTerminalBridgeOnce(
        {
          name: "failed-provider",
          writeFiles: async () => {},
          runCommand: async () => {
            calls++;
            return { exitCode, stdout: async () => "private output" };
          },
        },
        { source: "/* fixture */" }
      )
    ).rejects.toThrow("startup failed before readiness");
    expect(calls).toBe(1);
  }
);

test.each(["", "unhealthy", new Error("provider unavailable")])(
  "failed one-shot health is not retried: %s",
  async (health) => {
    let calls = 0;
    await expect(
      installTerminalBridgeOnce(
        {
          name: "health-provider",
          writeFiles: async () => {},
          runCommand: async () => {
            calls++;
            if (calls === 1)
              return {
                exitCode: 0,
                stdout: async () => "MOGPLEX_TERMINAL_BRIDGE_READY",
              };
            if (health instanceof Error) throw health;
            return { exitCode: 0, stdout: async () => health };
          },
        },
        { source: "/* fixture */" }
      )
    ).rejects.toThrow("failed to become ready");
    expect(calls).toBe(2);
  }
);
