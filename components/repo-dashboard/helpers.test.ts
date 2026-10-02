import { expect, it } from "vitest";
import type { Repo } from "@/lib/types";
import { mergeSyncedRepositories } from "./helpers";

const repo = (id: string, hidden = false) =>
  ({ id, full_name: `acme/${id}`, name: id, is_hidden: hidden }) as Repo;
it("keeps removed rows when GitHub sync supplies only the visible collection", () => {
  const merged = mergeSyncedRepositories(
    [repo("removed", true), repo("stale")],
    [repo("new")]
  );
  expect(merged.map((row) => row.id).sort()).toEqual(["new", "removed"]);
  expect(merged.find((row) => row.id === "removed")?.is_hidden).toBe(true);
});
it("accepts a current synced row instead of duplicating its hidden cached version", () => {
  const merged = mergeSyncedRepositories(
    [repo("restored", true)],
    [repo("restored")]
  );
  expect(merged).toHaveLength(1);
  expect(merged[0].is_hidden).toBe(false);
});
