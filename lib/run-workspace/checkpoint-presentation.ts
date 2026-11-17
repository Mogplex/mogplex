import {
  CHECKPOINT_MARKER_START as START,
  CHECKPOINT_MARKER_END as END,
  parseHarnessCheckpoint,
} from "@/lib/harness/checkpoint";

/** Presentation only: durable events retain the protocol used to pause a run. */
export function presentCheckpointText(input: string, streaming: boolean) {
  let remaining = input;
  let prose = "";
  const summaries: string[] = [];
  let start = remaining.indexOf(START);
  let hasProtocol = start !== -1;
  while (start !== -1) {
    prose += remaining.slice(0, start);
    const end = remaining.indexOf(END, start + START.length);
    // Withhold incomplete JSON; it is not a readable plan yet.
    if (end === -1) {
      remaining = "";
      break;
    }
    const after = end + END.length;
    const summary = parseHarnessCheckpoint(
      remaining.slice(start, after)
    )?.summary;
    if (summary) summaries.push(summary);
    remaining = remaining.slice(after);
    start = remaining.indexOf(START);
  }
  if (streaming) {
    // Deltas may split the opening marker at any character. Keep its partial
    // prefix out of the rendered transcript until the next delta resolves it.
    for (
      let size = Math.min(START.length - 1, remaining.length);
      size > 0;
      size--
    ) {
      if (remaining.endsWith(START.slice(0, size))) {
        hasProtocol = true;
        remaining = remaining.slice(0, -size);
        break;
      }
    }
  }
  prose += remaining;
  return hasProtocol ? prose.trim() || summaries.join("\n\n") : input;
}
