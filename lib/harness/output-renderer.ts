import type { HarnessId } from "@/lib/harness/config";
import { createSegmentStore, appendText, snapshot } from "./segment-store";
import { createClaudeOutputRenderer } from "./claude-renderer";
import { createCodexOutputRenderer } from "./codex-renderer";

export type { HarnessRenderChunk } from "./segment-store";

type HarnessOutputRenderer = {
  push: (
    stream: string,
    chunk: string
  ) => import("./segment-store").HarnessRenderChunk;
  flush: () => import("./segment-store").HarnessRenderChunk;
};

function createPassthroughRenderer(): HarnessOutputRenderer {
  const store = createSegmentStore();
  return {
    push: (_stream, chunk) => {
      appendText(store, chunk, "text");
      return snapshot(store);
    },
    flush: () => snapshot(store),
  };
}

export function createHarnessOutputRenderer(
  harnessId: HarnessId
): HarnessOutputRenderer {
  if (harnessId === "claude-code") {
    return createClaudeOutputRenderer();
  }

  if (harnessId === "codex") {
    return createCodexOutputRenderer();
  }

  return createPassthroughRenderer();
}
