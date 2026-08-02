import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_CATEGORIES, PRECONFIGURED_AGENTS } from "@/lib/agents/templates";

test("every built-in agent category has at least one preset agent", () => {
  const categoriesWithPresets = new Set(
    PRECONFIGURED_AGENTS.map((agent) => agent.category)
  );
  const empty = (
    Object.keys(AGENT_CATEGORIES) as Array<keyof typeof AGENT_CATEGORIES>
  ).filter((slug) => !categoriesWithPresets.has(slug));

  assert.deepEqual(
    empty,
    [],
    `Built-in categories without any preset agent: ${empty.join(", ")}. ` +
      `Empty tabs surface as "(0)" entries on /agents/roster — every built-in ` +
      `category should have at least one preset so users see what fits.`
  );
});

test("every preset agent uses a slug declared in AGENT_CATEGORIES", () => {
  const validSlugs = new Set(Object.keys(AGENT_CATEGORIES));
  const offenders = PRECONFIGURED_AGENTS.filter(
    (agent) => !validSlugs.has(agent.category)
  ).map((agent) => `${agent.name} (${agent.category})`);

  assert.deepEqual(
    offenders,
    [],
    `Preset agents using unknown category slugs: ${offenders.join(", ")}`
  );
});
