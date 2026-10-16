import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_MARKER_END,
  CHECKPOINT_MARKER_START,
  buildCheckpointProtocolInstructions,
  buildPlanFirstProtocolInstructions,
  parseHarnessCheckpoint,
} from "./checkpoint";

function block(body: string): string {
  return `${CHECKPOINT_MARKER_START}\n${body}\n${CHECKPOINT_MARKER_END}`;
}

describe("parseHarnessCheckpoint", () => {
  it("should return null when there is no checkpoint marker", () => {
    expect(parseHarnessCheckpoint("just some agent output")).toBeNull();
  });

  it("should extract the preview URL and summary from the block", () => {
    const output = [
      "Implemented the header change and verified it.",
      block(
        '{"previewUrl":"https://sb-abc.vercel.run","summary":"Moved sign in into the menu."}'
      ),
    ].join("\n");

    expect(parseHarnessCheckpoint(output)).toEqual({
      previewUrl: "https://sb-abc.vercel.run",
      summary: "Moved sign in into the menu.",
    });
  });

  it("should take the last checkpoint when several are present", () => {
    const output = [
      block('{"previewUrl":"https://first.example","summary":"first"}'),
      block('{"previewUrl":"https://second.example","summary":"second"}'),
    ].join("\n\n");

    expect(parseHarnessCheckpoint(output)?.previewUrl).toBe(
      "https://second.example"
    );
  });

  it("should reject a non-http preview URL but still count as a pause", () => {
    const output = block('{"previewUrl":"file:///etc/passwd","summary":"x"}');
    expect(parseHarnessCheckpoint(output)).toEqual({
      previewUrl: null,
      summary: "x",
    });
  });

  it("should treat a malformed body as a pause with no details", () => {
    expect(parseHarnessCheckpoint(block("not json"))).toEqual({
      previewUrl: null,
      summary: null,
    });
  });

  it("should handle a missing end marker by reading to the end", () => {
    const output = `${CHECKPOINT_MARKER_START}\n{"previewUrl":"https://x.example"}`;
    expect(parseHarnessCheckpoint(output)?.previewUrl).toBe(
      "https://x.example"
    );
  });
});

describe("buildCheckpointProtocolInstructions", () => {
  it("should name the markers and forbid foreground long-lived commands", () => {
    const text = buildCheckpointProtocolInstructions();
    expect(text).toContain(CHECKPOINT_MARKER_START);
    expect(text).toContain(CHECKPOINT_MARKER_END);
    expect(text.toLowerCase()).toContain("background");
    expect(text.toLowerCase()).toContain("do not open a pull request");
  });

  it("should require committing and pushing before a pause", () => {
    const text = buildCheckpointProtocolInstructions().toLowerCase();
    expect(text).toContain("commit");
    expect(text).toContain("push");
  });
});

describe("plan checkpoints", () => {
  it("should mark a plan checkpoint and keep review checkpoints unmarked", () => {
    expect(
      parseHarnessCheckpoint(
        block('{"kind":"plan","previewUrl":null,"summary":"- Add a toggle"}')
      )
    ).toEqual({ previewUrl: null, summary: "- Add a toggle", kind: "plan" });
    expect(
      parseHarnessCheckpoint(block('{"kind":"other","summary":"done"}'))
    ).toEqual({ previewUrl: null, summary: "done" });
  });

  it("should keep a plan whose summary has raw line breaks", () => {
    const checkpoint = parseHarnessCheckpoint(
      block('{"kind":"plan","summary":"- Add a toggle\n- Persist it"}')
    );
    expect(checkpoint).toEqual({
      previewUrl: null,
      summary: "- Add a toggle\n- Persist it",
      kind: "plan",
    });
  });

  it("should still parse a pretty-printed body", () => {
    expect(
      parseHarnessCheckpoint(
        block('{\n  "kind": "plan",\n  "summary": "one line"\n}')
      )
    ).toEqual({ previewUrl: null, summary: "one line", kind: "plan" });
  });

  it("should forbid file changes until the plan is approved", () => {
    const instructions = buildPlanFirstProtocolInstructions();
    expect(instructions).toContain("Do NOT create, edit, or delete files");
    expect(instructions).toContain('"kind":"plan"');
    expect(instructions).toContain(CHECKPOINT_MARKER_START);
  });
});
