import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  storeProviderKey,
  deleteProviderKey,
  listProviderKeys,
} from "@/lib/vault";
import type { Provider } from "@/lib/vault";

const VALID_PROVIDERS = new Set<Provider>([
  "ai_gateway",
  "anthropic",
  "openai",
  "openrouter",
]);

function isValidProvider(p: string): p is Provider {
  return VALID_PROVIDERS.has(p as Provider);
}

type SettingsKeysDeps = {
  requireUserId: typeof requireUserId;
  listProviderKeys: typeof listProviderKeys;
  storeProviderKey: typeof storeProviderKey;
  deleteProviderKey: typeof deleteProviderKey;
};

const defaultSettingsKeysDeps: SettingsKeysDeps = {
  requireUserId,
  listProviderKeys,
  storeProviderKey,
  deleteProviderKey,
};

export function createSettingsKeysGetHandler(
  overrides: Partial<SettingsKeysDeps> = {}
) {
  const deps: SettingsKeysDeps = {
    ...defaultSettingsKeysDeps,
    ...overrides,
  };

  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    try {
      const keys = await deps.listProviderKeys(userId);
      return NextResponse.json({ keys });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to list keys";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const GET = createSettingsKeysGetHandler();

export function createSettingsKeysPutHandler(
  overrides: Partial<SettingsKeysDeps> = {}
) {
  const deps: SettingsKeysDeps = {
    ...defaultSettingsKeysDeps,
    ...overrides,
  };

  return async function PUT(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: { provider?: string; key?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { provider, key } = body;

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (!key || typeof key !== "string" || key.trim().length === 0) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    try {
      await deps.storeProviderKey(userId, provider, key.trim());
      return NextResponse.json({ ok: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to store key";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const PUT = createSettingsKeysPutHandler();

export function createSettingsKeysDeleteHandler(
  overrides: Partial<SettingsKeysDeps> = {}
) {
  const deps: SettingsKeysDeps = {
    ...defaultSettingsKeysDeps,
    ...overrides,
  };

  return async function DELETE(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    let body: { provider?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { provider } = body;

    if (!provider || !isValidProvider(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    try {
      await deps.deleteProviderKey(userId, provider);
      return NextResponse.json({ ok: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete key";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

export const DELETE = createSettingsKeysDeleteHandler();
