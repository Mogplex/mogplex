import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalExec } from "./sandbox";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("sandbox GitHub capability gate", () => {
  it("rejects a cross-repository PR merge before starting a sandbox", async () => {
    const fetchSandbox = vi.fn(async () => Response.json({ exitCode: 0 }));
    global.fetch = fetchSandbox;
    const tool = createTerminalExec(
      undefined,
      "user-1",
      "11111111-1111-4111-8111-111111111111"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    await expect(
      tool.execute({
        command: "gh pr merge 42 --repo other-owner/other-repo --squash",
      })
    ).resolves.toMatchObject({
      reason: "github_write_capability_unavailable",
      error: expect.stringMatching(/select or connect.*write access/i),
    });
    expect(fetchSandbox).not.toHaveBeenCalled();
  });

  it("rejects unexposed GitHub write families before starting a sandbox", async () => {
    const fetchSandbox = vi.fn(async () => Response.json({ exitCode: 0 }));
    global.fetch = fetchSandbox;
    const tool = createTerminalExec(
      undefined,
      "user-1",
      "11111111-1111-4111-8111-111111111111"
    ) as unknown as {
      execute: (input: { command: string }) => Promise<unknown>;
    };

    for (const command of [
      "gh release create v1.0",
      "gh workflow run deploy.yml",
      "gh api graphql -f query='mutation { createIssue(input: {}) { issue { id } } }'",
    ]) {
      await expect(tool.execute({ command })).resolves.toMatchObject({
        reason: "github_write_capability_unavailable",
      });
    }
    expect(fetchSandbox).not.toHaveBeenCalled();
  });
});
