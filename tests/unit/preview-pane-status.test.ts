import assert from "node:assert/strict";
import test from "node:test";
import { formatPreviewToolbarStatus } from "../../components/preview-pane";

test("reachable idle-warning previews are labelled ready", () => {
  assert.equal(formatPreviewToolbarStatus("idle_warning"), "Ready");
});
