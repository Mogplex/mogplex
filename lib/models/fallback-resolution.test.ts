import { afterEach, describe, expect, it } from "vitest";
import { createResolveUserLanguageModel } from "@/lib/ai-model-resolver";
import { supabaseAdmin } from "@/lib/supabase/admin";

const originalFrom = Object.getOwnPropertyDescriptor(supabaseAdmin, "from");
afterEach(() => {
  if (originalFrom) Object.defineProperty(supabaseAdmin, "from", originalFrom);
  else Reflect.deleteProperty(supabaseAdmin, "from");
});

function database(saved: unknown, failingTable?: string) {
  const reads: string[] = [];
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    value: (table: string) => {
      reads.push(table);
      if (
        !["profiles", "ai_models", "user_model_preferences"].includes(table)
      ) {
        throw new Error(`Unexpected redundant access read: ${table}`);
      }
      const result = Promise.resolve({
        data:
          table === "profiles"
            ? { fallback_model_ids: saved, auto_enable_new_models: true }
            : table === "ai_models"
              ? ["openai/second", "openai/denied", "openai/retired"].map(
                  (id) => ({
                    id,
                    is_available: id !== "openai/retired",
                    is_hidden: false,
                  })
                )
              : [],
        error:
          table === failingTable ? { message: "Database unavailable" } : null,
      });
      const query = {
        select: () => query,
        eq: () => query,
        single: () => result,
        then: result.then.bind(result),
      };
      return query;
    },
  });
  return reads;
}

const resolver = () =>
  createResolveUserLanguageModel({
    getProviderKey: async () => "test-key",
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    resolveGatewayModel: () => "primary" as never,
  });

describe("gateway account fallback resolution", () => {
  it("reuses resolved scope access while still checking fresh catalog availability", async () => {
    const reads = database([
      "openai/second",
      "openai/denied",
      "openai/retired",
    ]);
    const result = await resolver()("owner", "openai/primary", {
      teamId: "team",
      capabilities: new Set(["models.*"]),
      allowlistState: {
        status: "restricted",
        models: ["openai/primary", "openai/second", "openai/retired"],
      },
    });
    expect(result.providerOptions?.gateway.models).toEqual(["openai/second"]);
    expect(reads).toEqual([
      "profiles",
      "ai_models",
      "user_model_preferences",
      "profiles",
    ]);
  });

  it.each(["profiles", "ai_models", "user_model_preferences"])(
    "keeps the primary and system defaults when %s cannot be read",
    async (table) => {
      database(["openai/second"], table);
      const result = await resolver()("owner", "openai/primary", {
        defaultGatewayFallbackModelIds: ["openai/system"],
      });
      expect(result.model).toBe("primary");
      expect(result.providerOptions?.gateway.models).toEqual(["openai/system"]);
    }
  );

  it.each([{ saved: null }, { saved: [] }, { saved: ["invalid"] }])(
    "preserves unset, disabled and invalid preference semantics: $saved",
    async ({ saved }) => {
      const reads = database(saved);
      const result = await resolver()("owner", "openai/primary", {
        defaultGatewayFallbackModelIds: ["openai/system"],
      });
      expect(result.providerOptions?.gateway.models).toEqual(
        Array.isArray(saved) && saved.length === 0
          ? undefined
          : ["openai/system"]
      );
      expect(reads).toEqual(["profiles"]);
    }
  );
});
