import {
  getProviderFromIconPath,
  PROVIDER_ICONS_BUCKET,
} from "@/lib/models/provider-icon";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const PROVIDER_ICON_LIST_PAGE_SIZE = 1000;

type ProviderIconFile = {
  name: string;
  updated_at: string | null;
};

export type StoredProviderIcon = {
  provider: string;
  updatedAt: string | null;
};

export type StoredProviderIconsResult = {
  data: StoredProviderIcon[] | null;
  error: { message: string } | null;
};

type ProviderIconStorageDeps = {
  listFiles: (
    offset: number,
    limit: number
  ) => Promise<{
    data: ProviderIconFile[] | null;
    error: { message: string } | null;
  }>;
};

const defaultProviderIconStorageDeps: ProviderIconStorageDeps = {
  async listFiles(offset, limit) {
    const { data, error } = await supabaseAdmin.storage
      .from(PROVIDER_ICONS_BUCKET)
      .list("", {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

    return {
      data,
      error: error ? { message: error.message } : null,
    };
  },
};

export function getStoredProviderIcons(files: ProviderIconFile[]) {
  return files
    .map((file) => {
      const provider = getProviderFromIconPath(file.name);
      return provider ? { provider, updatedAt: file.updated_at } : null;
    })
    .filter((icon): icon is StoredProviderIcon => icon !== null);
}

export async function listStoredProviderIcons(
  overrides: Partial<ProviderIconStorageDeps> = {}
): Promise<StoredProviderIconsResult> {
  const deps = { ...defaultProviderIconStorageDeps, ...overrides };
  const icons: StoredProviderIcon[] = [];
  const seenFileNames = new Set<string>();
  let offset = 0;
  let hasMore = true;

  // A compatible storage service may clamp the requested limit, so only an
  // empty page conclusively marks the end. Advance by the actual page length
  // and require unseen files on every non-empty page to prevent overlap or an
  // ignored offset from keeping the loop alive. Fail closed rather than return
  // a possibly truncated manifest when a page makes no progress.
  while (hasMore) {
    const { data, error } = await deps.listFiles(
      offset,
      PROVIDER_ICON_LIST_PAGE_SIZE
    );
    if (error || !data) {
      return {
        data: null,
        error: error ?? { message: "Storage returned no provider icon data" },
      };
    }
    if (data.length === 0) {
      hasMore = false;
      continue;
    }

    const unseenFiles = data.filter((file) => !seenFileNames.has(file.name));
    if (unseenFiles.length === 0) {
      return {
        data: null,
        error: { message: "Provider icon pagination did not advance" },
      };
    }
    for (const file of unseenFiles) {
      seenFileNames.add(file.name);
    }
    icons.push(...getStoredProviderIcons(unseenFiles));
    offset += data.length;
  }

  return {
    data: icons,
    error: null,
  };
}
