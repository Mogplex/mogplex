import assert from "node:assert/strict";
import test from "node:test";
import { formatTeamAuditPayload } from "../../lib/team-audit-presentation";

test("formatTeamAuditPayload shows when payload entries are truncated", () => {
  assert.equal(
    formatTeamAuditPayload({
      from_role: "viewer",
      to_role: "developer",
      actor: "admin",
      target: "user-1",
      reason: "manual",
      request_id: "req-1",
    }),
    "from role: viewer · to role: developer · actor: admin · target: user-1 · +2 more"
  );
});

test("formatTeamAuditPayload shows all entries when no truncation is needed", () => {
  assert.equal(
    formatTeamAuditPayload({
      role: "admin",
      enabled: true,
      count: 2,
      models: ["openai/gpt-5", "anthropic/claude"],
    }),
    'role: admin · enabled: true · count: 2 · models: ["openai/gpt-5","anthropic/claude"]'
  );
});

test("formatTeamAuditPayload returns null for empty payloads", () => {
  assert.equal(formatTeamAuditPayload({}), null);
});
