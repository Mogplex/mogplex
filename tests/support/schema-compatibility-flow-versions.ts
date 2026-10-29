import assert from "node:assert/strict";
import type { createPostgrestShim } from "@/lib/db/postgrest-shim";

const beforeUser = "00000000-0000-4000-8000-000000000001";
const graph = { nodes: [], edges: [] };

export async function checkRetainedFlowVersions(
  client: ReturnType<typeof createPostgrestShim>,
  phase: "seed" | "verify",
  userId: string
) {
  if (phase === "verify") {
    const saved = await client
      .from("flow_versions")
      .select("id,flow_id,version_number,graph")
      .eq("id", beforeUser)
      .single();
    assert.equal(saved.error, null, JSON.stringify(saved.error));
    assert.deepEqual(saved.data, {
      id: beforeUser,
      flow_id: beforeUser,
      version_number: 1,
      graph,
    });
    const edited = await client
      .from("flow_versions")
      .update({ graph })
      .eq("id", beforeUser)
      .select("id,version_number,graph")
      .single();
    assert.equal(edited.error, null, JSON.stringify(edited.error));
    assert.deepEqual(edited.data, { id: beforeUser, version_number: 1, graph });
  }
  // The retained publisher does not know about the new marker column.
  const inserted = await client
    .from("flow_versions")
    .insert({
      id: userId,
      flow_id: userId,
      version_number: 1,
      graph,
    })
    .select("id,version_number,graph")
    .single();
  assert.equal(inserted.error, null, JSON.stringify(inserted.error));
  assert.deepEqual(inserted.data, { id: userId, version_number: 1, graph });
}
