import { expect, it } from "vitest";
import { timelineSections } from "./timeline-sections";
import type { TimelineEvent } from "./types";

const user = (id: string): TimelineEvent => ({
  id,
  kind: "user",
  label: "YOU",
  time: "now",
  body: id,
});
const activity: TimelineEvent = {
  kind: "assistant",
  label: "MOGPLEX",
  time: "earlier",
  body: "Saved activity",
};

it("labels leading activity separately without changing request numbers or keys", () => {
  const requests = [user("first"), user("second")];
  const original = timelineSections(requests);
  const updated = timelineSections([activity, ...requests]);
  expect(updated.map((section) => section.label)).toEqual([
    "Earlier activity",
    "Request 1",
    "Latest request",
  ]);
  expect(updated.slice(1).map((section) => section.key)).toEqual(
    original.map((section) => section.key)
  );
});

it("keeps a recorded run together and names activity without a user correctly", () => {
  expect(timelineSections([activity])[0].label).toBe("Earlier activity");
  expect(timelineSections([activity, user("first")], true)).toEqual([
    { key: "recorded", label: "Recorded run", start: 0, end: 2 },
  ]);
});
