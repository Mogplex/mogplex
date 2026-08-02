import assert from "node:assert/strict";
import test from "node:test";
import {
  TERMINAL_PTY_FEATURE_FLAG,
  TERMINAL_PTY_PORT,
  isTerminalPtyEnabled,
} from "../../lib/sandbox/terminal-pty-config";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env[TERMINAL_PTY_FEATURE_FLAG];
  if (value === undefined) {
    delete process.env[TERMINAL_PTY_FEATURE_FLAG];
  } else {
    process.env[TERMINAL_PTY_FEATURE_FLAG] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[TERMINAL_PTY_FEATURE_FLAG];
    } else {
      process.env[TERMINAL_PTY_FEATURE_FLAG] = previous;
    }
  }
}

test("terminal PTY port is 4020 (matches retired bridge port)", () => {
  assert.equal(TERMINAL_PTY_PORT, 4020);
});

test("isTerminalPtyEnabled defaults to false when env var is unset", () => {
  withEnv(undefined, () => {
    assert.equal(isTerminalPtyEnabled(), false);
  });
});

test("isTerminalPtyEnabled treats '1' as enabled", () => {
  withEnv("1", () => {
    assert.equal(isTerminalPtyEnabled(), true);
  });
});

test("isTerminalPtyEnabled treats 'true' as enabled", () => {
  withEnv("true", () => {
    assert.equal(isTerminalPtyEnabled(), true);
  });
});

test("isTerminalPtyEnabled treats 'enabled' as enabled", () => {
  withEnv("enabled", () => {
    assert.equal(isTerminalPtyEnabled(), true);
  });
});

test("isTerminalPtyEnabled normalizes case and surrounding whitespace", () => {
  withEnv(" Enabled ", () => {
    assert.equal(isTerminalPtyEnabled(), true);
  });
});

test("isTerminalPtyEnabled treats other values as disabled", () => {
  for (const value of ["0", "false", "yes", ""]) {
    withEnv(value, () => {
      assert.equal(
        isTerminalPtyEnabled(),
        false,
        `expected disabled for ${JSON.stringify(value)}`
      );
    });
  }
});
