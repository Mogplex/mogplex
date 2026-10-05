import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createAgentTemplateSummariesGetHandler } from "@/lib/agents/template-summaries-handler";
import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates";

test("template summary response preserves all display metadata without prompts", async () => {
  const get = createAgentTemplateSummariesGetHandler({
    requireUserId: async () => "user-1",
  });
  const response = await get();
  assert.equal(response.status, 200);
  const data: unknown = await response.json();
  assert.deepEqual(
    data,
    PRECONFIGURED_AGENTS.map(({ name, description, category, model }) => ({
      name,
      description,
      category,
      model,
    }))
  );
  assert.ok(
    PRECONFIGURED_AGENTS.find(
      (t) => t.name === "SUPABASE-PATTERNS"
    )?.system_prompt.includes("postgres_changes")
  );
  assert.ok(!JSON.stringify(data).includes("system_prompt"));
  assert.ok(!JSON.stringify(data).includes("postgres_changes"));
});

test("template summaries preserve authentication failure without disclosing catalog data", async () => {
  const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const get = createAgentTemplateSummariesGetHandler({
    requireUserId: async () => denied,
  });
  assert.equal(await get(), denied);
});
