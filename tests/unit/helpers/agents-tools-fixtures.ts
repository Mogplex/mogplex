import crypto from "node:crypto";

export async function loadToolsModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/agents/tools");
}

export async function loadRestToolModule() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../lib/connections/rest-tool");
}

export function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>
) {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return callback().finally(() => {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

export async function withPatchedSandboxLookup<T>(
  data: { id: string } | null,
  callback: () => Promise<T>,
  options?: { repoLookupData?: { id: string } | null }
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { supabaseAdmin } = await import("../../../lib/supabase/admin");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    async single() {
      return { data, error: null };
    },
    async maybeSingle() {
      return { data: options?.repoLookupData ?? null, error: null };
    },
  };

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: () => query,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
}

export async function withPatchedFetch<T>(
  impl: typeof fetch,
  callback: () => Promise<T>
) {
  const originalFetch = global.fetch;
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: impl,
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  }
}

export function readAuthorizationHeader(init?: RequestInit) {
  if (init?.headers instanceof Headers) {
    return init.headers.get("authorization") ?? undefined;
  }
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization ?? headers?.authorization;
}

export function parseJsonRequestBody(body: BodyInit | null | undefined) {
  return typeof body === "string" ? (JSON.parse(body) as unknown) : undefined;
}

export type GithubInstallationsQueryCall = {
  method: "select" | "eq" | "ilike" | "limit";
  column?: string;
  value?: unknown;
};

export async function withPatchedGithubInstallations<T>(
  result: {
    data: Array<{
      installation_id?: number | null;
      account_login?: string | null;
    }> | null;
    error: { message: string } | null;
  },
  callback: () => Promise<T>,
  calls: GithubInstallationsQueryCall[] = []
) {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  const { supabaseAdmin } = await import("../../../lib/supabase/admin");
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

  const query = {
    select(columns: string) {
      calls.push({ method: "select", value: columns });
      return query;
    },
    eq(column: string, value: unknown) {
      calls.push({ method: "eq", column, value });
      return query;
    },
    ilike(column: string, value: unknown) {
      calls.push({ method: "ilike", column, value });
      return query;
    },
    limit(value: number) {
      calls.push({ method: "limit", value });
      return Promise.resolve(result);
    },
  };

  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: (table: string) =>
      table === "github_installations" ? query : originalFrom(table),
  });

  try {
    return await callback();
  } finally {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: originalFrom,
    });
  }
}

let testGithubAppPrivateKey: string | null = null;

export function createTestGithubAppPrivateKey() {
  // Shared across tests for speed; tests that need key rotation should reset it.
  testGithubAppPrivateKey ??= crypto
    .generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  return testGithubAppPrivateKey;
}
