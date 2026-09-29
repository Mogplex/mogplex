import { describe, expect, it } from "vitest";
import { parseSseDataEvents } from "./sse-data-events";

describe("parseSseDataEvents", () => {
  it("should parse complete events and keep the unfinished tail", () => {
    expect(
      parseSseDataEvents('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')
    ).toEqual({ events: [{ a: 1 }, { b: 2 }], remaining: 'data: {"c"' });
  });

  it("should join an event's data lines with a newline", () => {
    expect(
      parseSseDataEvents('event: x\ndata: {"text":\ndata: "hi"}\n\n').events
    ).toEqual([{ text: "hi" }]);
  });

  it("should skip a malformed event and keep reading", () => {
    expect(
      parseSseDataEvents('data: {not json\n\ndata: {"type":"done"}\n\n').events
    ).toEqual([{ type: "done" }]);
  });
});
