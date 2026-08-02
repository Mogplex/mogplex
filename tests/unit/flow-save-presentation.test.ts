import assert from "node:assert/strict";
import test from "node:test";
import { flowSaveStatusAnnouncement } from "../../lib/flows/save-presentation";

test("saved announcements require a clean draft saved in this session", () => {
  assert.equal(
    flowSaveStatusAnnouncement({
      status: "saved",
      error: null,
      dirty: false,
      savedInSession: true,
    }),
    "Saved"
  );
  assert.equal(
    flowSaveStatusAnnouncement({
      status: "saved",
      error: null,
      dirty: true,
      savedInSession: true,
    }),
    ""
  );
  assert.equal(
    flowSaveStatusAnnouncement({
      status: "saved",
      error: null,
      dirty: false,
      savedInSession: false,
    }),
    ""
  );
});

test("save errors include their actionable detail", () => {
  assert.equal(
    flowSaveStatusAnnouncement({
      status: "error",
      error: "Request timed out",
      dirty: true,
      savedInSession: false,
    }),
    "Save failed: Request timed out"
  );
});
