import { expect, it } from "vitest";
import { parseSlackThreadCancel } from "./thread-cancel";

const thread = { threadTs: "1.1", messageTs: "1.2" };
it.each([
  "mogplex-cancel",
  "  mogplex-cancel  ",
  "/mogplex-cancel",
  "<@UBOT> mogplex-cancel",
])("recognizes the explicit thread control %s", (text) => {
  expect(parseSlackThreadCancel({ ...thread, text })).toBe("");
});
it("preserves an explicit run ID", () => {
  expect(
    parseSlackThreadCancel({ ...thread, text: "mogplex-cancel run-id" })
  ).toBe("run-id");
});
it.each([
  "please add mogplex-cancel",
  "`mogplex-cancel`",
  "> mogplex-cancel",
  "mogplex-cancel should stop this thread",
  "cancel",
  "",
])("leaves ordinary conversation alone: %s", (text) => {
  expect(parseSlackThreadCancel({ ...thread, text })).toBeNull();
});
it("does not turn a root message into a thread cancellation", () => {
  expect(
    parseSlackThreadCancel({
      threadTs: "1.1",
      messageTs: "1.1",
      text: "mogplex-cancel",
    })
  ).toBeNull();
});
