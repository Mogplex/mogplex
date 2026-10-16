// Entry point for sandbox backends. App code gets its provider here and
// imports sandbox types from `@/lib/sandbox/provider/types`, never from a
// backend SDK.
import type {
  SandboxProvider,
  SandboxProviderId,
} from "@/lib/sandbox/provider/types";
import { vercelSandboxProvider } from "@/lib/sandbox/provider/vercel/vercel-provider";

// Static today, so importing this module loads the Vercel SDK. When a second
// backend lands, resolve providers lazily (dynamic import) so a deployment
// that never uses Vercel does not load its SDK.
const PROVIDERS: Record<SandboxProviderId, SandboxProvider> = {
  vercel: vercelSandboxProvider,
};

export const SANDBOX_PROVIDER_IDS = Object.keys(
  PROVIDERS
) as SandboxProviderId[];

function isSandboxProviderId(value: string): value is SandboxProviderId {
  return Object.hasOwn(PROVIDERS, value);
}

/**
 * The deployment's sandbox backend from `MOGPLEX_SANDBOX_PROVIDER`, default
 * `vercel`. An unknown value throws instead of silently falling back, so a
 * typo never sends agent code to an unexpected backend.
 */
export function resolveSandboxProviderId(
  env: Readonly<Record<string, string | undefined>> = process.env
): SandboxProviderId {
  const configured = env.MOGPLEX_SANDBOX_PROVIDER?.trim().toLowerCase();
  if (!configured) return "vercel";
  if (isSandboxProviderId(configured)) return configured;
  throw new Error(
    `Unknown MOGPLEX_SANDBOX_PROVIDER "${configured}". Supported: ${SANDBOX_PROVIDER_IDS.join(", ")}.`
  );
}

/** The sandbox provider this deployment uses. */
export function getSandboxProvider(
  env: Readonly<Record<string, string | undefined>> = process.env
): SandboxProvider {
  return PROVIDERS[resolveSandboxProviderId(env)];
}
