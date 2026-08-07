import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceGraph,
  createDefaultFlowGraph,
  getStartConfig,
  validateFlowGraph,
} from "../../lib/flows/graph";

function startNodeFromCoerce(filter: unknown, event = "pr_opened") {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event, filter },
      },
    ],
    edges: [],
  });
  const start = graph.nodes.find((node) => node.type === "start");
  assert.ok(start);
  return start.data;
}

test("coerceGraph preserves a fully-specified start.filter through round-trip", () => {
  const data = startNodeFromCoerce({
    scope: "org",
    installationIds: [12345],
    repos: ["acme/web"],
  });
  assert.deepEqual(data.filter, {
    scope: "org",
    installationIds: [12345],
    repos: ["acme/web"],
  });
});

test("coerceGraph drops an empty start.filter object so flows_no_filter counts it", () => {
  assert.equal(startNodeFromCoerce({}).filter, undefined);
  assert.equal(startNodeFromCoerce({ scope: "garbage" }).filter, undefined);
  assert.equal(
    startNodeFromCoerce({ installationIds: ["not-a-number"] }).filter,
    undefined
  );
});

test("coerceGraph keeps start.filter.authorFilter only for pr_opened", () => {
  // pr_opened routes with PR-author context, so the filter survives.
  assert.deepEqual(
    startNodeFromCoerce({ scope: "all", authorFilter: "dependabot_only" })
      .filter,
    { scope: "all", authorFilter: "dependabot_only" }
  );
  // Other events have no PR author; a stale dependabot_only left behind by an
  // event switch would fail closed on every delivery, so coercion drops it.
  // The explicit scope survives (it is harmless).
  assert.deepEqual(
    startNodeFromCoerce(
      { scope: "all", authorFilter: "dependabot_only" },
      "issue_opened"
    ).filter,
    { scope: "all" }
  );
  // With nothing but the stale author filter, the whole filter collapses.
  assert.equal(
    startNodeFromCoerce({ authorFilter: "dependabot_only" }, "issue_opened")
      .filter,
    undefined
  );
  // Non-author fields survive the strip.
  assert.deepEqual(
    startNodeFromCoerce(
      { scope: "org", repos: ["acme/web"], authorFilter: "exclude_dependabot" },
      "mention"
    ).filter,
    { scope: "org", repos: ["acme/web"] }
  );
});

test("coerceGraph normalizes start.filter scope and drops empty list fields", () => {
  // Default scope when omitted but other fields present.
  assert.deepEqual(startNodeFromCoerce({ installationIds: [1, 2] }).filter, {
    scope: "all",
    installationIds: [1, 2],
  });
  // Repos are trimmed and non-string entries dropped.
  assert.deepEqual(
    startNodeFromCoerce({
      scope: "all",
      repos: [" Acme/Web ", 42, "alice/dotfiles"],
    }).filter,
    { scope: "all", repos: ["Acme/Web", "alice/dotfiles"] }
  );
});

function startDataFromCoerce(data: Record<string, unknown>) {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", ...data },
      },
    ],
    edges: [],
  });
  const start = graph.nodes.find((node) => node.type === "start");
  assert.ok(start);
  return start.data;
}

test("coerceGraph keeps trimmed label fields only for the labeled event", () => {
  const labeled = startDataFromCoerce({
    event: "labeled",
    labelName: "  ready-for-review  ",
    labelPrOnly: true,
  });
  assert.equal(labeled.labelName, "ready-for-review");
  assert.equal(labeled.labelPrOnly, true);

  // Empty label name collapses to "any label" (field omitted entirely).
  const anyLabel = startDataFromCoerce({
    event: "labeled",
    labelName: "   ",
    labelPrOnly: false,
  });
  assert.equal(anyLabel.labelName, undefined);
  assert.equal(anyLabel.labelPrOnly, undefined);

  // Stale label fields left behind by an event switch are dropped so they
  // cannot silently narrow routing if the user switches back later.
  const stale = startDataFromCoerce({
    event: "pr_opened",
    labelName: "ready-for-review",
    labelPrOnly: true,
  });
  assert.equal(stale.labelName, undefined);
  assert.equal(stale.labelPrOnly, undefined);
});

test("getStartConfig exposes label fields for webhook routing", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: {
          label: "Label added",
          event: "labeled",
          labelName: "deploy",
          labelPrOnly: true,
        },
      },
    ],
    edges: [],
  });
  const start = getStartConfig(graph);
  assert.equal(start?.event, "labeled");
  assert.equal(start?.labelName, "deploy");
  assert.equal(start?.labelPrOnly, true);
});

test("coerceGraph keeps a trimmed tagPattern only for the tag_push event", () => {
  const tagged = startDataFromCoerce({
    event: "tag_push",
    tagPattern: "  v*  ",
  });
  assert.equal(tagged.tagPattern, "v*");

  const empty = startDataFromCoerce({ event: "tag_push", tagPattern: "   " });
  assert.equal(empty.tagPattern, undefined);

  const stale = startDataFromCoerce({ event: "push", tagPattern: "v*" });
  assert.equal(stale.tagPattern, undefined);
});

test("coerceGraph preserves only the selected external trigger configuration", () => {
  const schedule = startDataFromCoerce({
    event: "schedule",
    scheduleCron: " 0 9 * * 1-5 ",
    scheduleTimezone: " America/New_York ",
    slackTeamId: "stale",
  });
  assert.equal(schedule.scheduleCron, "0 9 * * 1-5");
  assert.equal(schedule.scheduleTimezone, "America/New_York");
  assert.equal(schedule.slackTeamId, undefined);

  const slack = startDataFromCoerce({
    event: "slack_mention",
    slackTeamId: " T123 ",
    slackChannelId: " C456 ",
    slackChannelName: " releases ",
    scheduleCron: "stale",
  });
  assert.equal(slack.slackTeamId, "T123");
  assert.equal(slack.slackChannelId, "C456");
  assert.equal(slack.slackChannelName, "releases");
  assert.equal(slack.scheduleCron, undefined);

  assert.equal(
    startDataFromCoerce({ event: "not-a-trigger" }).event,
    "mention"
  );
});

test("validateFlowGraph requires one repo and complete external trigger config", () => {
  const graph = createDefaultFlowGraph({
    event: "schedule",
    agentId: "agent-1",
    agentName: "Reviewer",
  });
  const start = graph.nodes.find((node) => node.type === "start");
  assert.ok(start);
  start.data = {
    ...start.data,
    event: "schedule",
    scheduleCron: "0 9 * * 1-5",
    scheduleTimezone: "America/New_York",
    filter: { scope: "all", repos: ["acme/web"] },
  };
  assert.deepEqual(validateFlowGraph(graph), { valid: true, errors: [] });

  start.data.filter = { scope: "all", repos: ["acme/web", "acme/api"] };
  assert.match(
    validateFlowGraph(graph).errors.join("\n"),
    /exactly one repository/i
  );

  start.data = {
    ...start.data,
    event: "slack_mention",
    filter: { scope: "all", repos: ["acme/web"] },
    slackTeamId: "",
    slackChannelId: "",
  };
  const slackErrors = validateFlowGraph(graph).errors.join("\n");
  assert.match(slackErrors, /select a workspace/i);
  assert.match(slackErrors, /select a channel/i);
});
