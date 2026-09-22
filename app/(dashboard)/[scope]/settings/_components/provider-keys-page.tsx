"use client";

import { useUser } from "@/hooks/use-user";
import { ApiKeysSection } from "./api-keys-section";

export function ProviderKeysPage() {
  const { user, isLoading } = useUser();
  return <ApiKeysSection platformAiEnabled={isLoading ? null : user?.platform_access?.allowPlatformAi ?? null} />;
}
