import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import {
  listStoredProviderIcons,
  type StoredProviderIcon,
} from "@/lib/models/provider-icon-storage";

type ProviderIconsGetDeps = {
  getUserId: () => Promise<string | undefined>;
  listStoredProviders: () => Promise<StoredProviderIcon[]>;
};

const getCachedStoredProviderIcons = unstable_cache(
  async () => {
    const result = await listStoredProviderIcons();
    if (result.error || !result.data) {
      throw new Error(
        result.error?.message ?? "Storage returned no provider icon data"
      );
    }
    return result.data;
  },
  ["provider-icon-manifest"],
  { revalidate: 300 }
);

const defaultProviderIconsGetDeps: ProviderIconsGetDeps = {
  getUserId,
  listStoredProviders: getCachedStoredProviderIcons,
};

export function createProviderIconsGetHandler(
  overrides: Partial<ProviderIconsGetDeps> = {}
) {
  const deps = { ...defaultProviderIconsGetDeps, ...overrides };

  return async function GET() {
    if (!(await deps.getUserId())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let storedProviders: StoredProviderIcon[];
    try {
      storedProviders = await deps.listStoredProviders();
    } catch {
      return NextResponse.json(
        { error: "Failed to load provider icons" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { providers: storedProviders.map((icon) => icon.provider) },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      }
    );
  };
}

export const GET = createProviderIconsGetHandler();
