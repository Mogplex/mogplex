import type { SandboxResolution } from "./sandbox-resolution";

export type SandboxRuntimeBinding = {
  sandboxId: string | null;
  status: "running" | "pending" | "unavailable";
};

export type SandboxSelection = string | SandboxRuntimeBinding | undefined;

export function readSelectedSandboxId(selection: SandboxSelection) {
  return typeof selection === "string" ? selection : selection?.sandboxId;
}

export function updateSandboxBinding(
  binding: SandboxRuntimeBinding | undefined,
  sandbox: SandboxResolution | null
) {
  if (!binding) return;
  binding.sandboxId = sandbox?.sandboxId ?? null;
  binding.status = sandbox?.status ?? "unavailable";
}
