/**
 * Split the complete events off a server-sent-events buffer and parse each
 * one's `data:` payload as JSON. The unfinished tail comes back as `remaining`
 * for the next chunk. A malformed event is skipped: the stream's terminal
 * event, not one bad line, decides how the stream ended.
 */
export function parseSseDataEvents(buffer: string) {
  const events: unknown[] = [];
  let remaining = buffer;
  let separatorIndex = remaining.indexOf("\n\n");
  while (separatorIndex !== -1) {
    const rawEvent = remaining.slice(0, separatorIndex);
    remaining = remaining.slice(separatorIndex + 2);
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      // SSE joins multiple data fields in one event with a newline.
      .join("\n");
    if (data) {
      try {
        events.push(JSON.parse(data));
      } catch {
        // Not JSON.
      }
    }
    separatorIndex = remaining.indexOf("\n\n");
  }
  return { events, remaining };
}
