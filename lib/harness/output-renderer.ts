import type { HarnessId } from "@/lib/harness/config";
import { createSegmentStore, appendText, snapshot } from "./segment-store";
import { createClaudeOutputRenderer } from "./claude-renderer";
import { createCodexOutputRenderer } from "./codex-renderer";
import { createAcpOutputRenderer } from "./acp/renderer";
import { parseAcpBridgeLine } from "./acp/protocol";

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

function createCliOutputRenderer(harnessId: HarnessId): HarnessOutputRenderer {
  if (harnessId === "claude-code") {
    return createClaudeOutputRenderer();
  }

  if (harnessId === "codex") {
    return createCodexOutputRenderer();
  }

  return createPassthroughRenderer();
}

/**
 * Picks the renderer from the output itself: a run behind the ACP bridge
 * starts stdout with a bridge event, and anything else is the harness CLI's
 * own format. Readers of saved or live output (the agent pane, automations,
 * the runs API) then never need to know which protocol produced it. Only
 * stdout waits for that first line; stderr reaches the CLI renderer at once,
 * as before, and the bridge prints its first line before the agent starts.
 */
export function createHarnessOutputRenderer(
  harnessId: HarnessId
): HarnessOutputRenderer {
  const cli = createCliOutputRenderer(harnessId);
  let active: HarnessOutputRenderer | null = null;
  let firstStdout = "";

  function choose(firstLine: string) {
    active = parseAcpBridgeLine(firstLine) ? createAcpOutputRenderer() : cli;
    return active;
  }

  return {
    push(stream, chunk) {
      if (active) return active.push(stream, chunk);
      if (stream !== "stdout") return cli.push(stream, chunk);
      firstStdout += chunk;
      const newline = firstStdout.indexOf("\n");
      if (newline === -1) return { text: "" };
      return choose(firstStdout.slice(0, newline)).push("stdout", firstStdout);
    },
    flush() {
      if (active) return active.flush();
      if (!firstStdout) return cli.flush();
      const renderer = choose(firstStdout);
      const pushed = renderer.push("stdout", firstStdout);
      const flushed = renderer.flush();
      return { ...flushed, text: pushed.text + flushed.text };
    },
  };
}
