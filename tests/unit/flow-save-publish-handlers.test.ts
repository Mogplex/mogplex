import assert from "node:assert/strict";
import test from "node:test";
import { useFlowSavePublishHandlers } from "../../components/panes/flows-pane/use-flow-save-publish-handlers";
import type { Flow } from "../../lib/types";
import { installControlHookDom } from "../support/control-hook-dom";
import { makeDraft } from "./helpers/flows-editor-fixtures";

test("persistFlow logs a failed save after the selected flow changes", async () => {
  const cleanup = installControlHookDom();
  const originalFetch = globalThis.fetch;
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  const saveStatuses: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  globalThis.fetch = async () => {
    throw new Error("network offline");
  };

  const draft = makeDraft();
  const { renderHook, act } = await import("@testing-library/react");
  const view = renderHook(() =>
    useFlowSavePublishHandlers({
      setHistory: () => {},
      setBaselineDraft: () => {},
      setSaving: () => {},
      setSaveStatus: (status) => {
        saveStatuses.push(status);
      },
      setSaveError: () => {},
      setSavedInSessionFlowId: () => {},
      setPublishing: () => {},
      setPublishSucceeded: () => {},
      autosaveTimeoutRef: { current: null },
      publishStateTimeoutRef: { current: null },
      autosaveAttemptSignatureRef: { current: null },
      hydratedFlowIdRef: { current: "flow-2" },
      draftSignatureRef: {
        current: "newer-draft-signature",
      },
      historyMergeRef: { current: { mergeKey: null, lastAt: 0 } },
      selectedFlow: { id: "flow-1" } as Flow,
      draft,
      dirty: true,
      publishing: false,
      saving: false,
      activeTeamId: null,
      mutateFlows: async () => undefined,
      mutateSelectedFlow: async () => undefined,
      publishSuccessStateMs: 1000,
    })
  );

  try {
    let saved: boolean | undefined;
    await act(async () => {
      saved = await view.result.current.persistFlow();
    });

    assert.equal(saved, false);
    assert.deepEqual(saveStatuses, ["saving"]);
    assert.deepEqual(warnings, [
      [
        "[flows] save failed for superseded draft",
        {
          flowId: "flow-1",
          flowChanged: true,
          signatureChanged: true,
          error: "network offline",
        },
      ],
    ]);
  } finally {
    view.unmount();
    globalThis.fetch = originalFetch;
    console.warn = originalConsoleWarn;
    cleanup();
  }
});
