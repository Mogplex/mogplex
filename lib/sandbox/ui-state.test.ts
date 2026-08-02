import { describe, expect, it } from "vitest";
import type { Session } from "@/hooks/use-sessions";
import { sandboxRecord } from "@/lib/sandbox/test-fixtures";
import {
  getSandboxUiHealthStatus,
  getSandboxUiPreviewUrl,
  isSandboxUiBooting,
  isSandboxUiErrored,
  isSandboxUiReachablePreview,
  isSandboxUiRuntimeRunning,
  isSandboxUiStopped,
  resolveSandboxPreviewOverlayStatus,
  resolveSandboxUiBundle,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";

const baseSession = {
  id: "session-1",
  index: 0,
  name: "Session 1",
  color: "blue",
  paneTree: { id: "pane-1", type: "chat" },
  activeId: "pane-1",
  activeSandboxId: "record-previous",
  pendingSandboxBranch: "feature/ui-state",
} as unknown as Session;

describe("resolveSandboxUiState", () => {
  it("returns no_session without a session or record", () => {
    expect(resolveSandboxUiState({ session: null, record: null })).toEqual({
      kind: "no_session",
    });
  });

  it("returns no_sandbox for a session without a record", () => {
    expect(
      resolveSandboxUiState({ session: baseSession, record: null })
    ).toEqual({
      kind: "no_sandbox",
      branch: "feature/ui-state",
      lastSandboxId: "record-previous",
    });
  });

  it("returns booting for creating and installing records", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "creating" }),
      })
    ).toEqual({
      kind: "booting",
      sandboxId: "record-1",
      phase: "creating",
    });

    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "installing" }),
      })
    ).toEqual({
      kind: "booting",
      sandboxId: "record-1",
      phase: "installing",
    });
  });

  it("surfaces pausing as a distinct booting runtime state", () => {
    const record = sandboxRecord({ status: "pausing" });
    const state = resolveSandboxUiState({ session: null, record });

    expect(resolveSandboxPreviewOverlayStatus({ session: null, record })).toBe(
      "pausing"
    );
    expect(state).toEqual({
      kind: "booting",
      sandboxId: "record-1",
      phase: "installing",
      runtimeStatus: "pausing",
    });
    expect(getSandboxUiHealthStatus(state)).toBe("pausing");
  });

  it("maps Vercel building diagnostics to booting without reimplementing overlay rules", () => {
    const record = sandboxRecord({
      healthStatus: "starting",
      diagnosticsState: "building",
    });

    expect(resolveSandboxPreviewOverlayStatus({ session: null, record })).toBe(
      "building"
    );
    expect(resolveSandboxUiState({ session: null, record })).toEqual({
      kind: "booting",
      sandboxId: "record-1",
      phase: "installing",
    });
  });

  it("returns starting when the VM is running but health is starting", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "running", healthStatus: "starting" }),
      })
    ).toEqual({
      kind: "starting",
      sandboxId: "record-1",
      previewUrl: "https://preview.example",
    });
  });

  it("returns live only when runtime, health, and preview URL are ready", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "running", healthStatus: "running" }),
      })
    ).toEqual({
      kind: "live",
      sandboxId: "record-1",
      previewUrl: "https://preview.example",
      expiresAt: "2026-05-13T13:00:00.000Z",
    });
  });

  it("bases live expiresAt on last_active_at, not created_at", () => {
    const record = sandboxRecord({
      status: "running",
      healthStatus: "running",
    });
    record.last_active_at = "2026-05-13T12:30:00.000Z";

    expect(resolveSandboxUiState({ session: null, record })).toMatchObject({
      kind: "live",
      expiresAt: "2026-05-13T13:30:00.000Z",
    });
  });

  it("returns degraded for app errors, unreachable previews, and idle warnings", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ healthStatus: "app_error" }),
      })
    ).toEqual({
      kind: "degraded",
      sandboxId: "record-1",
      reason: "app_error",
      previewUrl: "https://preview.example",
    });

    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ healthStatus: "unreachable" }),
      })
    ).toMatchObject({ kind: "degraded", reason: "unreachable" });

    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ healthStatus: "idle_warning" }),
      })
    ).toMatchObject({ kind: "degraded", reason: "idle_warning" });
  });

  it("returns paused with the saved snapshot id", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "paused", snapshotId: "snapshot-1" }),
      })
    ).toEqual({
      kind: "paused",
      sandboxId: "record-1",
      snapshotId: "snapshot-1",
    });
  });

  it("returns paused for a persistent paused sandbox without a snapshot id", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({
          status: "paused",
          snapshotId: null,
          persistent: true,
        }),
      })
    ).toEqual({
      kind: "paused",
      sandboxId: "record-1",
      snapshotId: null,
    });
  });

  it("returns errored when a legacy paused sandbox is missing a snapshot", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "paused", snapshotId: null }),
      })
    ).toEqual({
      kind: "errored",
      sandboxId: "record-1",
      message: "Paused sandbox is missing a snapshot",
    });
  });

  it("returns errored when overlay-derived paused state has no snapshot", () => {
    // Drives the terminal-overlay paused branch: persisted health_status is
    // 'paused' but runtime.status is still 'running', so the runtime resolver
    // falls through and the overlay path produces the paused overlay.
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({
          status: "running",
          healthStatus: "paused",
          snapshotId: null,
        }),
      })
    ).toEqual({
      kind: "errored",
      sandboxId: "record-1",
      message: "Paused sandbox is missing a snapshot",
    });
  });

  it("returns paused for an overlay-derived persistent sandbox without a snapshot", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({
          status: "running",
          healthStatus: "paused",
          snapshotId: null,
          persistent: true,
        }),
      })
    ).toEqual({
      kind: "paused",
      sandboxId: "record-1",
      snapshotId: null,
    });
  });

  it("returns stopped with the working branch", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "stopped" }),
      })
    ).toEqual({
      kind: "stopped",
      sandboxId: "record-1",
      reason: null,
      branch: "feature/chip",
    });
  });

  it("returns stopped with the persisted stop reason", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({
          status: "stopped",
          workingBranch: "feature/ui-state",
          stopReason: "idle_timeout",
        }),
      })
    ).toEqual({
      kind: "stopped",
      sandboxId: "record-1",
      reason: "idle_timeout",
      branch: "feature/ui-state",
    });
  });

  it("returns errored for unknown runtime statuses to surface schema drift", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ status: "terminating" }),
      })
    ).toEqual({
      kind: "errored",
      sandboxId: "record-1",
      message: "Unknown sandbox status: terminating",
    });
  });

  it("returns errored for runtime errors and failed deployment overlays", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({
          status: "error",
          displayError: "Install failed",
        }),
      })
    ).toEqual({
      kind: "errored",
      sandboxId: "record-1",
      message: "Install failed",
    });

    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({
          healthStatus: "app_error",
          diagnosticsState: "build_failed",
          displayError: "Build failed",
        }),
      })
    ).toEqual({
      kind: "errored",
      sandboxId: "record-1",
      message: "Build failed",
    });
  });

  it("prefers liveProbe over persisted health_status", () => {
    expect(
      resolveSandboxUiState({
        session: null,
        record: sandboxRecord({ healthStatus: "running" }),
        liveProbe: "starting",
      })
    ).toEqual({
      kind: "starting",
      sandboxId: "record-1",
      previewUrl: "https://preview.example",
    });
  });
});

describe("resolveSandboxUiBundle", () => {
  // Drift between state and overlayStatus was the motivating reason for the
  // bundle API; these tests assert the two derived values agree on the same
  // probe/diagnostic inputs that PreviewPane passes in.
  it("derives state and overlayStatus from the same liveProbe", () => {
    const bundle = resolveSandboxUiBundle({
      session: null,
      record: sandboxRecord({ healthStatus: "running" }),
      liveProbe: "starting",
    });
    expect(bundle.state).toMatchObject({ kind: "starting" });
    expect(bundle.overlayStatus).toBe("starting");
  });

  it("upgrades the overlay to build_failed when the liveProbe is starting and a Vercel build failed", () => {
    const bundle = resolveSandboxUiBundle({
      session: null,
      record: sandboxRecord({
        healthStatus: "running",
        diagnosticsState: "build_failed",
        displayError: "Build failed",
      }),
      liveProbe: "starting",
    });
    expect(bundle.overlayStatus).toBe("build_failed");
    expect(bundle.state).toMatchObject({ kind: "errored" });
  });

  it("keeps state and overlayStatus aligned for a healthy liveProbe", () => {
    const bundle = resolveSandboxUiBundle({
      session: null,
      record: sandboxRecord({ healthStatus: "idle_warning" }),
      liveProbe: "running",
    });
    expect(bundle.state).toMatchObject({ kind: "live" });
    expect(bundle.overlayStatus).toBe("running");
  });
});

describe("sandbox UI state predicates", () => {
  it("treats idle_warning sandboxes as reachable previews", () => {
    // Regression guard: the old getSandboxUiState included idle_warning in
    // isReachablePreview, which drives RepoCardMetadata previewUrl display
    // and activePreviewCount on the dashboard.
    const state = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({ healthStatus: "idle_warning" }),
    });
    expect(state).toMatchObject({ kind: "degraded", reason: "idle_warning" });
    expect(isSandboxUiReachablePreview(state)).toBe(true);
    expect(isSandboxUiRuntimeRunning(state)).toBe(true);
    expect(getSandboxUiPreviewUrl(state)).toBe("https://preview.example");
  });

  it("excludes app_error and unreachable from reachable preview", () => {
    const appErrorState = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({ healthStatus: "app_error" }),
    });
    expect(isSandboxUiReachablePreview(appErrorState)).toBe(false);
    expect(isSandboxUiRuntimeRunning(appErrorState)).toBe(true);

    const unreachableState = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({ healthStatus: "unreachable" }),
    });
    expect(isSandboxUiReachablePreview(unreachableState)).toBe(false);
    expect(isSandboxUiRuntimeRunning(unreachableState)).toBe(true);
  });

  it("treats live and starting sandboxes as reachable", () => {
    const live = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({ status: "running", healthStatus: "running" }),
    });
    expect(isSandboxUiReachablePreview(live)).toBe(true);
    expect(isSandboxUiRuntimeRunning(live)).toBe(true);
    expect(getSandboxUiPreviewUrl(live)).toBe("https://preview.example");

    const starting = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({ status: "running", healthStatus: "starting" }),
    });
    expect(isSandboxUiReachablePreview(starting)).toBe(true);
    expect(getSandboxUiPreviewUrl(starting)).toBe("https://preview.example");
  });

  it("omits the preview URL for booting sandboxes", () => {
    const booting = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({ status: "installing" }),
    });
    expect(isSandboxUiBooting(booting)).toBe(true);
    expect(isSandboxUiReachablePreview(booting)).toBe(false);
    expect(isSandboxUiRuntimeRunning(booting)).toBe(false);
    expect(getSandboxUiPreviewUrl(booting)).toBeUndefined();
  });

  it("flags stopped and errored sandboxes via their predicates", () => {
    const stopped = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({ status: "stopped" }),
    });
    expect(isSandboxUiStopped(stopped)).toBe(true);
    expect(isSandboxUiReachablePreview(stopped)).toBe(false);
    expect(getSandboxUiPreviewUrl(stopped)).toBeUndefined();

    const errored = resolveSandboxUiState({
      session: null,
      record: sandboxRecord({
        status: "error",
        displayError: "Install failed",
      }),
    });
    expect(isSandboxUiErrored(errored)).toBe(true);
    expect(isSandboxUiReachablePreview(errored)).toBe(false);
  });

  it("keeps resolveSandboxPreviewOverlayStatus aligned with bundle path", () => {
    const record = sandboxRecord({
      status: "running",
      healthStatus: "idle_warning",
    });
    expect(resolveSandboxPreviewOverlayStatus({ session: null, record })).toBe(
      "idle_warning"
    );
  });
});
