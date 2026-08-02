import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_CREATE_FIELDS,
  AGENT_UPDATE_FIELDS,
  pickAgentFields,
} from "../../lib/agents/input-sanitizer";

test("pickAgentFields keeps only allowlisted fields", () => {
  const body = {
    name: "assistant",
    model: "minimax/minimax-m2.5",
    system_prompt: "you are helpful",
    description: "desc",
    category: "code-review",
    source_template: "reviewer",
    // server-controlled fields a malicious client might send:
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "22222222-2222-2222-2222-222222222222",
    created_at: "2020-01-01T00:00:00Z",
    is_preset: true,
    has_fork: true,
    // nonsense field:
    __proto__injected: "ignored",
  };
  const picked = pickAgentFields(body, AGENT_CREATE_FIELDS);
  assert.deepEqual(Object.keys(picked).sort(), [...AGENT_CREATE_FIELDS].sort());
  assert.equal("id" in picked, false);
  assert.equal("user_id" in picked, false);
  assert.equal("created_at" in picked, false);
  assert.equal("is_preset" in picked, false);
});

test("pickAgentFields trims name, model, and category but leaves prompt untouched", () => {
  const picked = pickAgentFields(
    {
      name: "  my agent  ",
      model: " minimax/minimax-m2.5 ",
      category: "  code-review  ",
      system_prompt: "  leading and trailing whitespace is meaningful  ",
      description: "  keep as-is for now  ",
    },
    AGENT_CREATE_FIELDS
  );
  assert.equal(picked.name, "my agent");
  assert.equal(picked.model, "minimax/minimax-m2.5");
  assert.equal(picked.category, "code-review");
  assert.equal(
    picked.system_prompt,
    "  leading and trailing whitespace is meaningful  "
  );
  assert.equal(picked.description, "  keep as-is for now  ");
});

test("AGENT_UPDATE_FIELDS does not include source_template", () => {
  assert.equal(
    (AGENT_UPDATE_FIELDS as readonly string[]).includes("source_template"),
    false
  );
  const picked = pickAgentFields(
    { source_template: "attempted-rewrite", name: "ok" },
    AGENT_UPDATE_FIELDS
  );
  assert.equal("source_template" in picked, false);
  assert.equal(picked.name, "ok");
});

test("pickAgentFields tolerates non-object bodies", () => {
  assert.deepEqual(pickAgentFields(null, AGENT_CREATE_FIELDS), {});
  assert.deepEqual(pickAgentFields("nope", AGENT_CREATE_FIELDS), {});
  assert.deepEqual(pickAgentFields(42, AGENT_CREATE_FIELDS), {});
});

test("pickAgentFields preserves non-string values for typed fields", () => {
  // validateAgentInput is responsible for rejecting wrong types; the
  // sanitizer must not coerce them to strings silently.
  const picked = pickAgentFields(
    { name: 42, category: ["code-review"], description: null },
    AGENT_CREATE_FIELDS
  );
  assert.equal(picked.name, 42);
  assert.deepEqual(picked.category, ["code-review"]);
  assert.equal(picked.description, null);
});
