import assert from "node:assert/strict";
import test from "node:test";

async function loadToolsModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/agents/tools");
}

test("buildStaticTools defaults to ALL_CAPABILITIES — solo callers see every tool", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const tools = buildStaticTools(
    "sandbox-1",
    "user-1",
    "token",
    undefined,
    "repo-1"
  );
  // bash, web_search, virtual_exec — and the write_file/github_api that require sandboxId+token
  assert.ok(tools.bash, "bash should be present for solo");
  assert.ok(tools.web_search, "web_search should be present for solo");
  assert.ok(tools.virtual_exec, "virtual_exec should be present for solo");
  assert.ok(
    (tools as Record<string, unknown>).write_file,
    "write_file present when sandbox + bash cap"
  );
  assert.ok(
    (tools as Record<string, unknown>).github_api,
    "github_api present when token + cap"
  );
  assert.ok(
    (tools as Record<string, unknown>).github_pr_search,
    "github_pr_search present for authenticated users"
  );
  assert.ok(
    (tools as Record<string, unknown>).github_create_issue,
    "github_create_issue present for authenticated users"
  );
  assert.ok(
    (tools as Record<string, unknown>).github_update_pull_request,
    "github_update_pull_request present when token + cap"
  );
});

test("buildStaticTools filters bash/write_file/github_api out of viewer scope", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const viewerCaps = new Set([
    "models.*",
    "tools.web_search",
    "tools.web_fetch",
    "tools.virtual_exec",
  ]);
  const tools = buildStaticTools(
    "sandbox-1",
    "user-1",
    "token",
    undefined,
    "repo-1",
    undefined,
    viewerCaps
  );
  assert.equal((tools as Record<string, unknown>).bash, undefined);
  assert.equal((tools as Record<string, unknown>).write_file, undefined);
  assert.equal((tools as Record<string, unknown>).github_api, undefined);
  assert.equal((tools as Record<string, unknown>).github_pr_search, undefined);
  assert.equal(
    (tools as Record<string, unknown>).github_create_issue,
    undefined
  );
  assert.equal(
    (tools as Record<string, unknown>).github_update_pull_request,
    undefined
  );
  assert.equal((tools as Record<string, unknown>).read_file, undefined);
  assert.equal((tools as Record<string, unknown>).list_files, undefined);
  assert.equal((tools as Record<string, unknown>).start_sandbox, undefined);
  assert.equal((tools as Record<string, unknown>).stop_sandbox, undefined);
  // Viewer keeps these.
  assert.ok(tools.web_search);
  assert.ok(tools.web_fetch);
  assert.ok(tools.virtual_exec);
  assert.ok(tools.browse_skills, "browse_skills shares tools.web_fetch");
});

test("buildStaticTools keeps developer-level tools but excludes admin-only ones", async () => {
  const { buildStaticTools } = await loadToolsModule();
  const devCaps = new Set([
    "models.*",
    "tools.bash",
    "tools.write_file",
    "tools.web_search",
    "tools.web_fetch",
    "tools.virtual_exec",
    "tools.github_api",
    "tools.memories",
    "connections.create",
  ]);
  const tools = buildStaticTools(
    "sandbox-1",
    "user-1",
    "token",
    undefined,
    "repo-1",
    undefined,
    devCaps
  );
  assert.ok(tools.bash);
  assert.ok((tools as Record<string, unknown>).write_file);
  assert.ok((tools as Record<string, unknown>).github_api);
  assert.ok((tools as Record<string, unknown>).github_pr_search);
  assert.ok((tools as Record<string, unknown>).github_create_issue);
  assert.ok((tools as Record<string, unknown>).github_update_pull_request);
  assert.ok((tools as Record<string, unknown>).read_file);
  assert.ok((tools as Record<string, unknown>).list_files);
});

test("filterToolsByCapability with empty caps drops every tool (fail closed)", async () => {
  const { filterToolsByCapability } = await loadToolsModule();
  const filtered = filterToolsByCapability(
    { bash: {} as never, web_search: {} as never },
    new Set()
  );
  assert.deepEqual(filtered, {});
});

test("filterToolsByCapability drops unknown keys (fail closed for unregistered tools)", async () => {
  const { filterToolsByCapability } = await loadToolsModule();
  const filtered = filterToolsByCapability(
    { totally_new_tool: {} as never },
    new Set(["*"])
  );
  // '*' short-circuits — admin gets everything, including unregistered tools.
  assert.ok((filtered as Record<string, unknown>).totally_new_tool);

  const filtered2 = filterToolsByCapability(
    { totally_new_tool: {} as never },
    new Set(["tools.*"])
  );
  // No registered cap for unknown key → dropped under non-wildcard caps.
  assert.equal(
    (filtered2 as Record<string, unknown>).totally_new_tool,
    undefined
  );
});

test("filterToolsByCapability does not report unmapped tools as denied", async () => {
  const { filterToolsByCapability } = await loadToolsModule();
  const denied: Array<{ toolName: string; requiredCapability: string | null }> =
    [];

  const filtered = filterToolsByCapability(
    { totally_new_tool: {} as never },
    new Set(["tools.*"]),
    () => undefined,
    (toolName, requiredCapability) => {
      denied.push({ toolName, requiredCapability });
    }
  );

  assert.deepEqual(filtered, {});
  assert.deepEqual(denied, []);
});

test("TOOL_CAPABILITY covers every static tool key buildStaticTools emits (no drift)", async () => {
  const { buildStaticTools, TOOL_CAPABILITY } = await loadToolsModule();
  const tools = buildStaticTools(
    "sandbox-1",
    "user-1",
    "token",
    undefined,
    "repo-1"
  );
  const unmapped: string[] = [];
  for (const key of Object.keys(tools)) {
    if (!TOOL_CAPABILITY[key]) unmapped.push(key);
  }
  assert.deepEqual(
    unmapped,
    [],
    `Static tools without a TOOL_CAPABILITY entry will be filtered out under non-wildcard caps: ${unmapped.join(", ")}`
  );
});
