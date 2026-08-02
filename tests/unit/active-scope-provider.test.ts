import assert from "node:assert/strict";
import test from "node:test";

test("active scope helpers attach the current team header without dropping existing headers", async () => {
  const { ACTIVE_TEAM_HEADER } = await import("../../lib/team-capabilities");
  const { getActiveTeamRequestHeaders, setActiveTeamIdForRequests } =
    await import("../../components/active-scope-provider");

  setActiveTeamIdForRequests(null);
  const personalHeaders = getActiveTeamRequestHeaders({
    accept: "application/json",
  });
  assert.equal(personalHeaders.get(ACTIVE_TEAM_HEADER), null);
  assert.equal(personalHeaders.get("accept"), "application/json");

  setActiveTeamIdForRequests(" team-123 ");
  const teamHeaders = getActiveTeamRequestHeaders({
    "content-type": "application/json",
  });
  assert.equal(teamHeaders.get(ACTIVE_TEAM_HEADER), "team-123");
  assert.equal(teamHeaders.get("content-type"), "application/json");

  setActiveTeamIdForRequests(null);
});
