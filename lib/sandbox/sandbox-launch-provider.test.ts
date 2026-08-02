// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SandboxLaunchProvider,
  useSandboxLaunchActions,
} from "@/components/sandbox-launch-provider";
import { useSandboxStore } from "@/hooks/use-sandbox";
import type { SandboxLaunchRepo } from "@/lib/sandbox/launch-intent";

const repo: SandboxLaunchRepo = {
  id: "repo-1",
  full_name: "webrenew/mogplex",
  default_branch: "main",
  root_directory: null,
  is_monorepo: false,
  sandbox_env_vars: {},
  env_sync_mode: "sandbox-only",
  vercel_project_id: null,
};

function LaunchModalTrigger() {
  const { launchRepoSandbox } = useSandboxLaunchActions();

  return createElement(
    "button",
    {
      type: "button",
      "data-testid": "trigger-launch",
      onClick: () => {
        void launchRepoSandbox(repo, {
          source: "test",
          trigger: "snapshot",
          intent: { kind: "start_fresh" },
        });
      },
    },
    "trigger"
  );
}

describe("SandboxLaunchProvider", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (
          url === `/api/repos/${repo.id}/launch-presets` &&
          method === "GET"
        ) {
          return Response.json({
            presets: [],
          });
        }

        throw new Error(`Unexpected fetch in launch modal test: ${url}`);
      })
    );
    useSandboxStore.setState({
      sandboxes: {},
      sandboxesById: {},
      sandboxIdsByRepoId: {},
      activeSandboxId: null,
      creating: new Set(),
      creatingCounts: {},
      errors: {},
      logs: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("snapshots the launch modal heading and description", async () => {
    render(
      createElement(
        SandboxLaunchProvider,
        null,
        createElement(LaunchModalTrigger)
      )
    );

    fireEvent.click(screen.getByTestId("trigger-launch"));

    const title = await screen.findByRole("heading", {
      level: 2,
      name: "Start a new sandbox",
    });
    const description = await screen.findByText(
      /Choose how webrenew\/mogplex should open/
    );

    expect({
      title: title.textContent,
      subtitle: description.textContent,
    }).toMatchInlineSnapshot(`
      {
        "subtitle": "Choose how webrenew/mogplex should open. Use this when you want a clean slate — to keep working on an existing chat's branch, just reopen the chat.",
        "title": "Start a new sandbox",
      }
    `);
  });
});
