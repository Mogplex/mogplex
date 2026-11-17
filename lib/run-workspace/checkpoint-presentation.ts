import {
  CHECKPOINT_MARKER_START as START,
  CHECKPOINT_MARKER_END as END,
  parseHarnessCheckpoint,
} from "@/lib/harness/checkpoint";

/** Presentation of contiguous assistant text; user and tool content is untouched. */
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
  // Deltas may split the opening marker at any character. Keep its partial
  // prefix out of the rendered transcript until the next delta resolves it.
  // A live '<' is held until the next delta disambiguates it. Once a run
  // stops, keep ordinary punctuation but hide unmistakable truncated markers.
  const minimumPrefix = streaming ? 1 : "<<<MOGPLEX_".length;
  for (
    let size = Math.min(START.length - 1, remaining.length);
    size >= minimumPrefix;
    size--
  ) {
    if (remaining.endsWith(START.slice(0, size))) {
      hasProtocol = true;
      remaining = remaining.slice(0, -size);
      break;
    }
  }
  prose += remaining;
  if (!hasProtocol) return input;
  return prose.trim() ? prose.trimEnd() : summaries.join("\n\n");
}
