import assert from "node:assert/strict";
import test from "node:test";
import playwrightConfig from "../../playwright.config";

test("Playwright disables Sentry for both the build and test server", () => {
  const webServer = Array.isArray(playwrightConfig.webServer)
    ? playwrightConfig.webServer[0]
    : playwrightConfig.webServer;

  assert.ok(webServer);

  const commands = webServer.command
    .split("&&")
    .map((command) => command.trim());
  assert.equal(commands.length, 2);

  for (const command of commands) {
    assert.match(command, /(?:^|\s)SENTRY_DSN=(?:\s|$)/);
    assert.match(command, /(?:^|\s)NEXT_PUBLIC_SENTRY_DSN=(?:\s|$)/);
  }
});
