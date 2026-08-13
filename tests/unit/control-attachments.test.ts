import assert from "node:assert/strict";
import test from "node:test";
import {
  appendControlComposerFiles,
  type ControlComposerFile,
} from "../../components/control/control-attachments";

function attachment(id: string): ControlComposerFile {
  return {
    id,
    type: "file",
    mediaType: "text/plain",
    filename: `${id}.txt`,
    url: `data:text/plain,${id}`,
  };
}

test("appendControlComposerFiles enforces the cap against current state", () => {
  const firstRead = [attachment("one"), attachment("two"), attachment("three")];
  const concurrentRead = [
    attachment("four"),
    attachment("five"),
    attachment("six"),
  ];

  const afterFirstRead = appendControlComposerFiles([], firstRead);
  const afterConcurrentRead = appendControlComposerFiles(
    afterFirstRead,
    concurrentRead
  );

  assert.deepEqual(
    afterConcurrentRead.map((file) => file.id),
    ["one", "two", "three", "four", "five"]
  );
});
