import assert from "node:assert/strict";
import test from "node:test";
import type { Repo } from "../../lib/types";
import { mergeSyncedRepositories } from "../../components/repo-dashboard/helpers";

const repo = (id: string, hidden = false) =>
  ({ id, full_name: `acme/${id}`, name: id, is_hidden: hidden }) as Repo;
test("keeps removed rows when GitHub sync supplies only the visible collection", () => {
  const merged = mergeSyncedRepositories(
    [repo("removed", true), repo("stale")],
    [repo("new")]
  );
  assert.deepEqual(merged.map((row) => row.id).sort(), ["new", "removed"]);
  assert.equal(merged.find((row) => row.id === "removed")?.is_hidden, true);
});
test("accepts a current synced row instead of duplicating its hidden cached version", () => {
  const merged = mergeSyncedRepositories(
    [repo("restored", true)],
    [repo("restored")]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].is_hidden, false);
});
