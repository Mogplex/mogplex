import assert from "node:assert/strict";
import test from "node:test";
import {
  loadToolsModule,
  withEnv,
  withPatchedFetch,
  withPatchedSandboxLookup,
} from "./helpers/agents-tools-fixtures";

test("start_sandbox rejects a pending JSON response without readiness events", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(null, async () => {
      await withPatchedFetch(
        async () =>
          Response.json(
            {
              sandbox: {
                id: "sandbox-record-1",
                status: "installing",
              },
            },
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          ),
        async () => {
          const { createStartSandbox } = await loadToolsModule();
          const tool = createStartSandbox("user-123") as unknown as {
            execute: (input: { repoId: string }) => Promise<unknown>;
          };

          const result = await tool.execute({
            repoId: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
          });

          assert.deepEqual(result, {
            error:
              "Sandbox is still starting, but no readiness stream was available.",
            reason: "sandbox_unavailable",
          });
        }
      );
    });
  });
});

test("start_sandbox waits for the sandbox readiness event over SSE", async () => {
  const encoder = new TextEncoder();

  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(null, async () => {
      await withPatchedFetch(
        async () => {
          let readyTimer: ReturnType<typeof setTimeout> | null = null;
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "sandbox_created", recordId: "sandbox-record-2" })}\n\n`
                )
              );
              readyTimer = setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "ready", sandbox: { id: "sandbox-record-2" } })}\n\n`
                  )
                );
                controller.close();
              }, 250);
            },
            cancel() {
              if (readyTimer) {
                clearTimeout(readyTimer);
                readyTimer = null;
              }
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        },
        async () => {
          const { createStartSandbox } = await loadToolsModule();
          const tool = createStartSandbox("user-123") as unknown as {
            execute: (input: { repoId: string }) => Promise<unknown>;
          };

          const result = await tool.execute({
            repoId: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
          });

          assert.deepEqual(result, {
            ok: true,
            sandboxId: "sandbox-record-2",
            status: "running",
            sandboxResolution: "created",
            message: "Sandbox is ready to use.",
          });
        }
      );
    });
  });
});

test("start_sandbox fails closed when a full_name does not resolve even if another sandbox is already running", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(
      { id: "sandbox-unrelated" },
      async () => {
        const { createStartSandbox } = await loadToolsModule();
        const tool = createStartSandbox("user-123") as unknown as {
          execute: (input: { repoId: string }) => Promise<unknown>;
        };

        const result = (await tool.execute({
          repoId: "webrenew/missing-repo",
        })) as { error?: string; sandboxId?: string };

        assert.equal(result.error, "Repository not found for this user.");
        assert.equal(result.sandboxId, undefined);
      },
      { repoLookupData: null }
    );
  });
});

test("start_sandbox rejects invalid non-UUID repoIds instead of reusing another sandbox", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup({ id: "sandbox-unrelated" }, async () => {
      const { createStartSandbox } = await loadToolsModule();
      const tool = createStartSandbox("user-123") as unknown as {
        execute: (input: { repoId: string }) => Promise<unknown>;
      };

      const result = (await tool.execute({
        repoId: "repo-123",
      })) as { error?: string; sandboxId?: string };

      assert.equal(result.error, "Repository not found for this user.");
      assert.equal(result.sandboxId, undefined);
    });
  });
});

test("start_sandbox resolves a GitHub full_name to the repo UUID before posting", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(
      null,
      async () => {
        const capturedBodies: string[] = [];
        await withPatchedFetch(
          async (_url, init) => {
            capturedBodies.push(
              typeof init?.body === "string" ? init.body : ""
            );
            return Response.json(
              { sandbox: { id: "sandbox-xyz", status: "running" } },
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          },
          async () => {
            const { createStartSandbox } = await loadToolsModule();
            const tool = createStartSandbox("user-123") as unknown as {
              execute: (input: { repoId: string }) => Promise<unknown>;
            };

            const result = (await tool.execute({
              repoId: "webrenew/bloom",
            })) as { ok: boolean; sandboxId: string };

            assert.equal(result.ok, true);
            assert.equal(result.sandboxId, "sandbox-xyz");
            assert.equal(capturedBodies.length, 1);
            assert.deepEqual(JSON.parse(capturedBodies[0]), {
              repoId: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
            });
          }
        );
      },
      {
        repoLookupData: { id: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b" },
      }
    );
  });
});

test("start_sandbox returns an error when a full_name does not map to an owned repo", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(
      null,
      async () => {
        const { createStartSandbox } = await loadToolsModule();
        const tool = createStartSandbox("user-123") as unknown as {
          execute: (input: { repoId: string }) => Promise<unknown>;
        };

        const result = (await tool.execute({
          repoId: "webrenew/unknown-repo",
        })) as { error?: string };

        assert.equal(result.error, "Repository not found for this user.");
      },
      { repoLookupData: null }
    );
  });
});

test("terminal_exec returns the automatically resolved sandbox identity", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup({ id: "sandbox-record-1" }, async () => {
      await withPatchedFetch(
        async () =>
          Response.json({
            exitCode: 0,
            stdout: "ghs_toolOutputToken",
            stderr: "",
          }),
        async () => {
          const { createTerminalExec } = await loadToolsModule();
          const tool = createTerminalExec(
            undefined,
            "user-123",
            "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b"
          ) as unknown as {
            execute: (input: { command: string }) => Promise<unknown>;
          };

          assert.deepEqual(await tool.execute({ command: "pwd" }), {
            exitCode: 0,
            stdout: "[redacted]",
            stderr: "",
            command: "pwd",
            sandboxId: "sandbox-record-1",
            sandboxResolution: "reused_running",
          });
        }
      );
    });
  });
});

test("terminal_exec refuses credential extraction and GitHub mutations", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    let fetched = false;
    await withPatchedFetch(
      async () => {
        fetched = true;
        return Response.json({ exitCode: 0, stdout: "", stderr: "" });
      },
      async () => {
        const { createTerminalExec } = await loadToolsModule();
        const tool = createTerminalExec(
          "sandbox-record-1",
          "user-123",
          "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b"
        ) as unknown as {
          execute: (input: { command: string }) => Promise<unknown>;
        };

        assert.deepEqual(
          await tool.execute({ command: "cat ~/.git-credentials" }),
          {
            error:
              "Credential access is blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
            reason: "credential_access_blocked",
            command: "cat ~/.git-credentials",
          }
        );
        assert.deepEqual(
          await tool.execute({ command: "echo $GITHUB_TOKEN" }),
          {
            error:
              "Credential access is blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
            reason: "credential_access_blocked",
            command: "echo $GITHUB_TOKEN",
          }
        );
        assert.deepEqual(
          await tool.execute({ command: "cat ~/.config/gh/hosts.yml" }),
          {
            error:
              "Credential access is blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
            reason: "credential_access_blocked",
            command: "cat ~/.config/gh/hosts.yml",
          }
        );
        assert.deepEqual(await tool.execute({ command: "env | grep TOKEN" }), {
          error:
            "Credential access is blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
          reason: "credential_access_blocked",
          command: "env | grep TOKEN",
        });
        assert.deepEqual(
          await tool.execute({ command: "cat /proc/self/environ" }),
          {
            error:
              "Credential access is blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
            reason: "credential_access_blocked",
            command: "cat /proc/self/environ",
          }
        );
        assert.deepEqual(
          await tool.execute({
            command:
              "curl -X POST https://api.github.com/repos/acme/repo/issues",
          }),
          {
            error:
              "Raw GitHub API mutations are blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
            reason: "github_mutation_blocked",
            command:
              "curl -X POST https://api.github.com/repos/acme/repo/issues",
          }
        );
        assert.deepEqual(
          await tool.execute({ command: "gh issue create --title exploit" }),
          {
            error:
              "GitHub CLI mutations are blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
            reason: "github_mutation_blocked",
            command: "gh issue create --title exploit",
          }
        );
        assert.deepEqual(
          await tool.execute({
            command:
              "python3 -c 'import requests; requests.post(\"https://api.github.com/repos/acme/repo/issues\")'",
          }),
          {
            error:
              "Raw GitHub API mutations are blocked in agent shell commands. Use the scoped GitHub tool for GitHub actions.",
            reason: "github_mutation_blocked",
            command:
              "python3 -c 'import requests; requests.post(\"https://api.github.com/repos/acme/repo/issues\")'",
          }
        );
      }
    );
    assert.equal(fetched, false);
  });
});

test("terminal_exec refuses to guess when multiple repo sandboxes are running", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedSandboxLookup(
      [{ id: "sandbox-record-1" }, { id: "sandbox-record-2" }],
      async () => {
        let fetched = false;
        await withPatchedFetch(
          async () => {
            fetched = true;
            return Response.json({ exitCode: 0 });
          },
          async () => {
            const { createTerminalExec } = await loadToolsModule();
            const tool = createTerminalExec(
              undefined,
              "user-123",
              "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b"
            ) as unknown as {
              execute: (input: { command: string }) => Promise<unknown>;
            };

            assert.deepEqual(await tool.execute({ command: "pwd" }), {
              error:
                "Multiple running sandboxes are available for this repository. Select one explicitly before continuing.",
              reason: "multiple_sandboxes",
              command: "pwd",
            });
          }
        );
        assert.equal(fetched, false);
      }
    );
  });
});

test("sandbox_stop posts to the non-deleting lifecycle route with delegated auth", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    await withPatchedFetch(
      async (url, init) => {
        capturedUrl = url.toString();
        capturedInit = init;
        return Response.json({
          sandbox: {
            id: "sandbox-record-1",
            runtime_summary: { status: "stopped" },
            error_summary: { current_error: null },
          },
        });
      },
      async () => {
        const { createStopSandbox } = await loadToolsModule();
        const tool = createStopSandbox("user-123") as unknown as {
          execute: (input: { sandboxId: string }) => Promise<unknown>;
        };

        assert.deepEqual(
          await tool.execute({ sandboxId: "sandbox-record-1" }),
          {
            ok: true,
            sandboxId: "sandbox-record-1",
            status: "stopped",
            message:
              "Sandbox compute stopped. Its record and worktree bindings remain available for restart.",
          }
        );
      }
    );

    assert.equal(
      capturedUrl,
      "http://localhost:3000/api/sandbox/sandbox-record-1/stop"
    );
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.body, undefined);
    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get("authorization"), "Bearer internal-secret");
    assert.equal(headers.get("x-delegated-user-id"), "user-123");
    assert.equal(headers.get("content-type"), "application/json");
  });
});

test("sandbox_stop does not report success when Stop remains unconfirmed", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedFetch(
      async () =>
        Response.json({
          sandbox: {
            id: "sandbox-record-1",
            runtime_summary: { status: "running" },
            error_summary: {
              current_error:
                "Remote VM could not be confirmed stopped. The record remains active for reconciliation.",
            },
          },
        }),
      async () => {
        const { createStopSandbox } = await loadToolsModule();
        const tool = createStopSandbox("user-123") as unknown as {
          execute: (input: { sandboxId: string }) => Promise<unknown>;
        };

        assert.deepEqual(
          await tool.execute({ sandboxId: "sandbox-record-1" }),
          {
            error:
              "Remote VM could not be confirmed stopped. The record remains active for reconciliation.",
            reason: "sandbox_unavailable",
            sandboxId: "sandbox-record-1",
            status: "running",
          }
        );
      }
    );
  });
});

test("sandbox_stop classifies stale or client-invented record identifiers", async () => {
  await withEnv({ INTERNAL_API_SECRET: "internal-secret" }, async () => {
    await withPatchedFetch(
      async () =>
        Response.json({ error: "Sandbox not found" }, { status: 404 }),
      async () => {
        const { createStopSandbox } = await loadToolsModule();
        const tool = createStopSandbox("user-123") as unknown as {
          execute: (input: { sandboxId: string }) => Promise<unknown>;
        };

        assert.deepEqual(
          await tool.execute({ sandboxId: "client-invented-sandbox" }),
          {
            error: "Sandbox not found",
            reason: "sandbox_not_found",
          }
        );
      }
    );
  });
});
