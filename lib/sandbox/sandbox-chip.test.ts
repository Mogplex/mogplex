import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SandboxChip } from "@/components/sandbox-chip";
import type { Session } from "@/hooks/use-sessions";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";
import {
  isSandboxUiBooting,
  isSandboxUiDegraded,
  isSandboxUiErrored,
  isSandboxUiLive,
  isSandboxUiNoSandbox,
  isSandboxUiNoSession,
  isSandboxUiPaused,
  isSandboxUiStarting,
  isSandboxUiStopped,
  resolveSandboxUiState,
  type SandboxUiState,
} from "@/lib/sandbox/ui-state";

const session = {
  id: "session-1",
  index: 0,
  name: "Session 1",
  color: "blue",
  paneTree: { id: "pane-1", type: "chat" },
  activeId: "pane-1",
  activeSandboxId: "record-previous",
  pendingSandboxBranch: "feature/chip",
} as unknown as Session;

export function stateWith(
  state: SandboxUiState,
  assertState: (state: SandboxUiState) => boolean
) {
  expect(assertState(state)).toBe(true);
  return state;
}

export function renderChip(state: SandboxUiState) {
  return renderToStaticMarkup(createElement(SandboxChip, { state }));
}

describe("SandboxChip", () => {
  it("matches the resolver-backed chip label table", () => {
    const rows = [
      [
        "booting:creating",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ status: "creating" }),
            }),
            isSandboxUiBooting
          )
        ),
      ],
      [
        "booting:installing",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ status: "installing" }),
            }),
            isSandboxUiBooting
          )
        ),
      ],
      [
        "booting:pausing",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ status: "pausing" }),
            }),
            isSandboxUiBooting
          )
        ),
      ],
      [
        "starting",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ healthStatus: "starting" }),
            }),
            isSandboxUiStarting
          )
        ),
      ],
      [
        "live",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ healthStatus: "running" }),
            }),
            isSandboxUiLive
          )
        ),
      ],
      [
        "degraded:idle_warning",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ healthStatus: "idle_warning" }),
            }),
            isSandboxUiDegraded
          )
        ),
      ],
      [
        "degraded:app_error",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ healthStatus: "app_error" }),
            }),
            isSandboxUiDegraded
          )
        ),
      ],
      [
        "degraded:unreachable",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ healthStatus: "unreachable" }),
            }),
            isSandboxUiDegraded
          )
        ),
      ],
      [
        "paused",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({
                status: "paused",
                snapshotId: "snapshot-1",
              }),
            }),
            isSandboxUiPaused
          )
        ),
      ],
      [
        "stopped",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({ status: "stopped" }),
            }),
            isSandboxUiStopped
          )
        ),
      ],
      [
        "errored",
        renderChip(
          stateWith(
            resolveSandboxUiState({
              session: null,
              record: sandboxRecord({
                status: "error",
                displayError: "Sandbox failed",
              }),
            }),
            isSandboxUiErrored
          )
        ),
      ],
      [
        "no_sandbox",
        renderChip(
          stateWith(
            resolveSandboxUiState({ session, record: null }),
            isSandboxUiNoSandbox
          )
        ),
      ],
      [
        "no_session",
        renderChip(
          stateWith(
            resolveSandboxUiState({ session: null, record: null }),
            isSandboxUiNoSession
          )
        ),
      ],
    ];

    expect(rows).toMatchInlineSnapshot(`
      [
        [
          "booting:creating",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-border-dim bg-background text-muted-foreground"><span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span>starting · provisioning</span>",
        ],
        [
          "booting:installing",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-border-dim bg-background text-muted-foreground"><span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span>starting · installing</span>",
        ],
        [
          "booting:pausing",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-border-dim bg-background text-muted-foreground"><span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span>pausing</span>",
        ],
        [
          "starting",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-border-dim bg-background text-muted-foreground"><span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span>starting dev server</span>",
        ],
        [
          "live",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-accent-green/20 bg-accent-green/[0.06] text-accent-green"><span class="h-1.5 w-1.5 rounded-full bg-accent-green"></span>ready</span>",
        ],
        [
          "degraded:idle_warning",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-accent-green/20 bg-accent-green/[0.06] text-accent-green"><span class="h-1.5 w-1.5 rounded-full bg-accent-green"></span>ready</span>",
        ],
        [
          "degraded:app_error",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-red-500/20 bg-red-500/[0.06] text-red-500"><span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>app error</span>",
        ],
        [
          "degraded:unreachable",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-amber-400/20 bg-amber-400/[0.06] text-amber-400"><span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>unreachable</span>",
        ],
        [
          "paused",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-border-dim bg-background text-muted-foreground"><span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span>paused · resume</span>",
        ],
        [
          "stopped",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-border-dim bg-muted/20 text-muted-foreground"><span class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></span>stopped</span>",
        ],
        [
          "errored",
          "<span class="inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] border-red-500/20 bg-red-500/[0.06] text-red-500"><span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>error</span>",
        ],
        [
          "no_sandbox",
          "",
        ],
        [
          "no_session",
          "",
        ],
      ]
    `);
  });

  it("keeps runtime policy hidden behind a stable ready state", () => {
    const liveState = stateWith(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ healthStatus: "running" }),
      }),
      isSandboxUiLive
    );
    const idleState = stateWith(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ healthStatus: "idle_warning" }),
      }),
      isSandboxUiDegraded
    );

    for (const rendered of [renderChip(liveState), renderChip(idleState)]) {
      expect(rendered).toContain(">ready</span>");
      expect(rendered).not.toMatch(/\d+m left|idle|animate-pulse/);
    }
  });
});
