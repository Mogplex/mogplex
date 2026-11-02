import type { TimelineEvent } from "./types";

/** Keep chat message identity independent of activity inserted ahead of it. */
export function timelineSections(events: TimelineEvent[], recordedRun = false) {
  if (recordedRun)
    return [
      { key: "recorded", label: "Recorded run", start: 0, end: events.length },
    ];
  const starts = [
    0,
    ...events.flatMap((event, index) =>
      event.kind === "user" && index > 0 ? [index] : []
    ),
  ];
  const latest = events.findLastIndex((event) => event.kind === "user");
  let requestNumber = 0;
  return starts.map((start, index) => {
    const user = events[start]?.kind === "user";
    if (user) requestNumber++;
    return {
      key: user
        ? (events[start].id ?? `request-${requestNumber}`)
        : "earlier-activity",
      label: user
        ? start === latest
          ? "Latest request"
          : `Request ${requestNumber}`
        : "Earlier activity",
      start,
      end: starts[index + 1] ?? events.length,
    };
  });
}
