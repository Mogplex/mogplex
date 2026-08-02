import assert from "node:assert/strict";
import test from "node:test";

async function loadDevServerGuard() {
  return import("../../lib/sandbox/dev-server-guard");
}

test("shouldWarnAboutDevServerCommand only flags healthy previews", async () => {
  const { shouldWarnAboutDevServerCommand } = await loadDevServerGuard();

  assert.equal(
    shouldWarnAboutDevServerCommand(
      "pnpm run dev",
      "https://preview.example.com",
      "running"
    ),
    true
  );
  assert.equal(
    shouldWarnAboutDevServerCommand(
      "pnpm run dev",
      "https://preview.example.com",
      "app_error"
    ),
    false
  );
  assert.equal(
    shouldWarnAboutDevServerCommand(
      "pnpm run build",
      "https://preview.example.com",
      "running"
    ),
    false
  );
});

test("trackPtyCommandInput reconstructs typed commands across keypresses", async () => {
  const { trackPtyCommandInput } = await loadDevServerGuard();

  let line: string | null = "";
  for (const chunk of ["pnpm", " ", "run", " ", "dev"]) {
    const tracked = trackPtyCommandInput(line, chunk);
    line = tracked.nextLine;
    assert.equal(tracked.submittedCommand, null);
  }

  const submitted = trackPtyCommandInput(line, "\r");

  assert.equal(submitted.submittedCommand, "pnpm run dev");
  assert.equal(submitted.nextLine, "");
});

test("trackPtyCommandInput disables tracking after unsupported escape sequences", async () => {
  const { trackPtyCommandInput } = await loadDevServerGuard();

  const escaped = trackPtyCommandInput("", "\u001B[A");
  assert.equal(escaped.nextLine, null);

  const submitted = trackPtyCommandInput(escaped.nextLine, "\r");
  assert.equal(submitted.submittedCommand, null);
  assert.equal(submitted.nextLine, "");
});
