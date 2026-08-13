import assert from "node:assert/strict";
import test from "node:test";
import { mergeControlSessionLists } from "../../lib/control/session-list-merge";

test("mergeControlSessionLists preserves local mutations and adds fetched sessions", () => {
  const current = [
    { id: "new", title: "Locally created" },
    { id: "renamed", title: "Local rename" },
  ];
  const fetched = [
    { id: "renamed", title: "Stale title" },
    { id: "existing", title: "Existing session" },
    { id: "archived", title: "Stale archived session" },
  ];

  assert.deepEqual(
    mergeControlSessionLists(current, fetched, new Set(["archived"])),
    [current[0], current[1], fetched[1]]
  );
});
