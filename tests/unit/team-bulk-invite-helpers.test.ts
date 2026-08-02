import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkEmails,
  isValidInviteEmail,
  MAX_BULK_INVITE_EMAILS,
  prepareBulkInviteEmails,
  summarizeBulkInviteResults,
  type BulkInviteResult,
} from "../../lib/team-bulk-invite";

test("isValidInviteEmail accepts common shapes and rejects garbage", () => {
  assert.equal(isValidInviteEmail("alice@example.com"), true);
  assert.equal(isValidInviteEmail("alice+team@example.co.uk"), true);
  assert.equal(isValidInviteEmail(""), false);
  assert.equal(isValidInviteEmail("not-an-email"), false);
  assert.equal(isValidInviteEmail("@example.com"), false);
  assert.equal(isValidInviteEmail("alice@"), false);
  assert.equal(isValidInviteEmail("alice @example.com"), false);
});

test("prepareBulkInviteEmails normalizes (trim + lowercase), dedupes, and partitions invalid", () => {
  const { validEmails, preResults } = prepareBulkInviteEmails([
    "Alice@Example.com",
    "  alice@example.com  ",
    "bob@example.com",
    "",
    "garbage",
    "alice@example.com",
    42,
    null,
    undefined,
  ]);

  assert.deepEqual(validEmails, ["alice@example.com", "bob@example.com"]);

  // 1 of the dupes lands as skipped_duplicate (the second "Alice@..."),
  // and another dupe ("alice@example.com" at the end) lands as well.
  const dupes = preResults.filter((r) => r.status === "skipped_duplicate");
  assert.equal(dupes.length, 2);
  for (const r of dupes) assert.equal(r.email, "alice@example.com");

  const invalids = preResults.filter((r) => r.status === "skipped_invalid");
  // empty string, "garbage", 42, null, undefined → 5 invalid entries
  assert.equal(invalids.length, 5);
});

test("prepareBulkInviteEmails preserves the original input length in preResults+validEmails", () => {
  const input = [
    "a@example.com",
    "b@example.com",
    "a@example.com", // duplicate
    "bad",
    "",
  ];
  const { validEmails, preResults } = prepareBulkInviteEmails(input);
  assert.equal(validEmails.length + preResults.length, input.length);
});

test("summarizeBulkInviteResults counts every status accurately", () => {
  const results: BulkInviteResult[] = [
    { email: "a@x.com", status: "invited", invite_id: "1" },
    { email: "b@x.com", status: "invited", invite_id: "2" },
    { email: "c@x.com", status: "skipped_member" },
    { email: "d@x.com", status: "skipped_invalid" },
    { email: "e@x.com", status: "skipped_duplicate" },
    { email: "f@x.com", status: "delivery_failed", invite_id: "3" },
    { email: "g@x.com", status: "insert_failed" },
  ];
  const summary = summarizeBulkInviteResults(results, 10);
  assert.deepEqual(summary, {
    total_requested: 10,
    invited: 2,
    skipped_member: 1,
    skipped_invalid: 1,
    skipped_duplicate: 1,
    delivery_failed: 1,
    insert_failed: 1,
  });
});

test("MAX_BULK_INVITE_EMAILS is 100 (load-bearing for the route's 422 guard)", () => {
  assert.equal(MAX_BULK_INVITE_EMAILS, 100);
});

test("chunkEmails splits at the requested size", () => {
  const items = Array.from({ length: 23 }, (_, i) => `e${i}@x.com`);
  const chunks = chunkEmails(items, 10);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 10);
  assert.equal(chunks[1].length, 10);
  assert.equal(chunks[2].length, 3);
  // Concatenating chunks recovers the original order.
  assert.deepEqual(chunks.flat(), items);
});
