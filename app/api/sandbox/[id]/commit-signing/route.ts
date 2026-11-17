import { z } from "zod";
import {
  loadOwnedSandboxRouteContext,
  buildSandboxRouteErrorResponse,
} from "@/lib/sandbox/route-context";
import { getCommitSigningKeyView } from "@/lib/commit-signing/storage";
import { resolveSandboxWorkingDirectory } from "@/lib/sandbox/working-directory";
import {
  buildSigningVerificationScript,
  signingVerificationResult,
} from "@/lib/commit-signing/verify-workspace";

import type { SandboxRunCommandParams } from "@/lib/sandbox/provider/types";
import type { SandboxRouteFailure } from "@/lib/sandbox/route-context";

export type SigningVerificationDeps = {
  loadContext: (
    request: Request,
    id: string,
    options: { select: string; requireCapability: "tools.bash" }
  ) => Promise<
    | SandboxRouteFailure
    | {
        ok: true;
        auth: { userId: string };
        rootDirectory: string | null | undefined;
        sandbox: {
          currentSession: () => {
            status: string;
            runCommand: (
              command: SandboxRunCommandParams
            ) => Promise<{ exitCode: number }>;
          };
        } | null;
      }
  >;
  loadKey: typeof getCommitSigningKeyView;
};
const defaults: SigningVerificationDeps = {
  loadContext: loadOwnedSandboxRouteContext,
  loadKey: getCommitSigningKeyView,
};
const select =
  "id,sandbox_id,root_directory,billing_source,billing_team_id,billing_project_id,vercel_team_id,vercel_project_id,repo:repos(root_directory)";

export function createSigningVerificationHandler(
  deps: SigningVerificationDeps = defaults
) {
  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success)
      return Response.json({ error: "Invalid workspace" }, { status: 400 });
    try {
      const context = await deps.loadContext(request, id, {
        select,
        requireCapability: "tools.bash",
      });
      if (!context.ok) {
        if (context.status >= 500)
          return Response.json(
            {
              error:
                "Workspace signing verification is temporarily unavailable. Try again.",
            },
            { status: 503 }
          );
        return buildSandboxRouteErrorResponse(context);
      }
      const key = await deps.loadKey(context.auth.userId);
      if (!key)
        return Response.json(
          { error: "Save a signing key before checking a workspace." },
          { status: 409 }
        );
      // Pin the current session. Neither the lookup nor command may wake a paused VM.
      const session = context.sandbox?.currentSession();
      if (session?.status !== "running")
        return Response.json({
          status: "paused",
          message:
            "Resume this workspace before verifying signing. Verification does not start it automatically.",
        });
      const command = await session.runCommand({
        cmd: "sh",
        args: [
          "-c",
          buildSigningVerificationScript(),
          "signing-check",
          key.publicKey.trim().split(/\s+/).slice(0, 2).join(" "),
        ],
        cwd: resolveSandboxWorkingDirectory(null, context.rootDirectory),
      });
      const result = signingVerificationResult(command.exitCode);
      // A concurrent key replacement must not validate the newly displayed key.
      const current = await deps.loadKey(context.auth.userId);
      if (current?.publicKey !== key.publicKey)
        return Response.json(
          { error: "Your signing key changed during verification. Try again." },
          { status: 409 }
        );
      return Response.json({
        ...result,
        fingerprint: key.fingerprint,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      return Response.json(
        {
          error:
            "Workspace signing verification is temporarily unavailable. Try again.",
        },
        { status: 503 }
      );
    }
  };
}

export const POST = createSigningVerificationHandler();
