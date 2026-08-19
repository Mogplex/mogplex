import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { collectControlArtifacts } from "../../components/control/artifact-side-panel-model";

test("control artifacts do not promote assistant text into artifacts", () => {
  const artifacts = collectControlArtifacts([
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "## Release plan\n\n| Step | Action |\n| --- | --- |\n| 1 | Verify plan mode |",
        },
      ],
    } as UIMessage,
  ]);

  assert.equal(artifacts.length, 0);
});

test("control artifacts ignore all assistant chat and collect assistant files", () => {
  const artifacts = collectControlArtifacts([
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Done." }],
    } as UIMessage,
    {
      id: "assistant-2",
      role: "assistant",
      parts: [
        {
          type: "file",
          filename: "diagram.png",
          mediaType: "image/png",
          url: "data:image/png;base64,abc",
        },
      ],
    } as UIMessage,
  ]);

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.kind, "file");
  assert.equal(artifacts[0]?.title, "diagram.png");
});
