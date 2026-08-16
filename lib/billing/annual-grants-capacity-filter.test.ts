import { afterAll, beforeAll, describe, expect, it } from "vitest";

let annualGrants: typeof import("./annual-grants");
let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
let originalFrom: typeof supabaseAdmin.from;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  annualGrants = await import("./annual-grants");
});

afterAll(() => {
  Object.defineProperty(supabaseAdmin, "from", {
    configurable: true,
    writable: true,
    value: originalFrom,
  });
});

describe("legacy annual grant candidate loading", () => {
  it("excludes capacity-v2 accounts from the recurring repair scan", async () => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return query;
      },
      not: () => query,
      order: () => query,
      range: async () => ({ data: [], error: null }),
    };
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      writable: true,
      value: (table: string) => {
        expect(table).toBe("billing_accounts");
        return query;
      },
    });

    await expect(annualGrants.loadAnnualGrantCandidates()).resolves.toEqual([]);
    expect(filters).toContainEqual(["plan_audience", "legacy"]);
  });
});
