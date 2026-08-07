export async function loadSandboxTreeRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../app/api/sandbox/[id]/tree/route");
}

export type RunCommandInput = { cmd: string; args: string[] };
export type RunCommandResult = {
  exitCode: number;
  stderr: () => Promise<string>;
  stdout: () => Promise<string>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SandboxContext = any;

export function buildBaseSandboxContext(overrides?: {
  runCommand?: (input: RunCommandInput) => Promise<RunCommandResult>;
  writeFiles?: (
    writes: Array<{ path: string; content: Buffer }>
  ) => Promise<void>;
}): SandboxContext {
  return {
    ok: true,
    auth: {},
    record: { sandbox_id: "sandbox-runtime-1" },
    repo: { root_directory: "apps/web" },
    rootDirectory: "apps/web",
    context: {},
    sandbox: {
      runCommand:
        overrides?.runCommand ??
        (async () => ({
          exitCode: 0,
          stderr: async () => "",
          stdout: async () => "",
        })),
      writeFiles: overrides?.writeFiles ?? (async () => {}),
    },
  };
}

export function buildTreeRouteParams(id = "sandbox-1") {
  return { params: Promise.resolve({ id }) };
}

export function buildTreeRouteRequest(
  method: string,
  body?: Record<string, unknown>
) {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost/api/sandbox/sandbox-1/tree", init);
}

export function buildDefaultDeps(contextOverride?: SandboxContext) {
  return {
    loadOwnedSandboxRouteContext: async () =>
      contextOverride ?? buildBaseSandboxContext(),
    touchSandboxLastActive: async () => {},
    renewSandboxActivityLease: async () => 0,
  };
}
