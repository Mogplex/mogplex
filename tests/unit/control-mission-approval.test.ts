import assert from "node:assert/strict";
import test from "node:test";
import { approveMissionEvent } from "../../lib/control/utils";
import type { Mission } from "../../lib/control/types";

const mission = (id: string, timeline: Mission["timeline"]): Mission => ({
  id,
  title: id,
  ws: "",
  status: "active",
  pinned: false,
  age: "now",
  cost: 0,
  base: "main",
  env: "-",
  permissions: "Skip Permissions",
  approval: "Human merge",
  sandbox: "container-med",
  archived: false,
  targets: [],
  timeline,
});

const approval = (resolved = ""): Mission["timeline"][number] => ({
  kind: "approval",
  label: "Approval",
  time: "now",
  body: "",
  approvalText: "Merge?",
  resolved,
});

test("approveMissionEvent resolves only the targeted approval on the selected mission", () => {
  const missions = [
    mission("m1", [approval(), approval()]),
    mission("m2", [approval()]),
  ];

  const next = approveMissionEvent(missions, "m1", 1);

  assert.equal(
    next[0].timeline[0].kind === "approval" && next[0].timeline[0].resolved,
    ""
  );
  assert.match(
    (next[0].timeline[1].kind === "approval" && next[0].timeline[1].resolved) ||
      "",
    /Approved by you/
  );
  assert.equal(next[1], missions[1]);
  assert.notEqual(next[0], missions[0]);
});
