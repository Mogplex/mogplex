import { NextResponse } from "next/server";
import type { DecisionChecksOwner } from "./account-setting";

export type DecisionChecksResponse = {
  enabled: boolean;
  viewer: { canManage: boolean };
};

/** Who is asking, and whether they may change the setting they are reading. */
export type DecisionChecksAccess =
  | {
      ok: true;
      owner: DecisionChecksOwner;
      canManage: boolean;
      actorId: string;
    }
  | { ok: false; response: Response };

export type DecisionChecksHandlerDeps = {
  read: (owner: DecisionChecksOwner) => Promise<boolean | null>;
  write: (owner: DecisionChecksOwner, enabled: boolean) => Promise<boolean>;
  /** Drop this process's cached choice so the change applies at once. */
  forget: (owner: DecisionChecksOwner) => void;
  /** Runs after a stored change. A failure here never undoes the change. */
  onChanged?: (change: {
    owner: DecisionChecksOwner;
    actorId: string;
    from: boolean;
    to: boolean;
  }) => Promise<void>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

/** Shared GET for the personal and the team route. */
export async function handleDecisionChecksGet(
  access: DecisionChecksAccess,
  deps: DecisionChecksHandlerDeps
): Promise<Response> {
  if (!access.ok) return access.response;
  try {
    const enabled = await deps.read(access.owner);
    if (enabled === null) return json({ error: "Not found" }, 404);
    const body: DecisionChecksResponse = {
      enabled,
      viewer: { canManage: access.canManage },
    };
    return json(body);
  } catch (error) {
    console.error("[decisions] failed to load the account setting", { error });
    return json({ error: "Unable to load the setting" }, 500);
  }
}

/** The one accepted body field, or null for anything that is not a boolean. */
async function readEnabled(request: Request): Promise<boolean | null> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { enabled } = body as Record<string, unknown>;
  return typeof enabled === "boolean" ? enabled : null;
}

/** Shared PATCH. The body is exactly `{ "enabled": boolean }`. */
export async function handleDecisionChecksPatch(
  request: Request,
  access: DecisionChecksAccess,
  deps: DecisionChecksHandlerDeps
): Promise<Response> {
  if (!access.ok) return access.response;
  if (!access.canManage) return json({ error: "Forbidden" }, 403);

  const enabled = await readEnabled(request);
  if (enabled === null) {
    return json({ error: "enabled must be true or false" }, 422);
  }

  try {
    const previous = await deps.read(access.owner);
    if (previous === null) return json({ error: "Not found" }, 404);
    if (!(await deps.write(access.owner, enabled))) {
      return json({ error: "Not found" }, 404);
    }
    deps.forget(access.owner);
    if (previous !== enabled && deps.onChanged) {
      await deps
        .onChanged({
          owner: access.owner,
          actorId: access.actorId,
          from: previous,
          to: enabled,
        })
        .catch((error: unknown) => {
          console.warn("[decisions] failed to audit a setting change", {
            error,
          });
        });
    }
    const response: DecisionChecksResponse = {
      enabled,
      viewer: { canManage: true },
    };
    return json(response);
  } catch (error) {
    console.error("[decisions] failed to save the account setting", { error });
    return json(
      { error: "Unable to save the setting. No changes were applied." },
      500
    );
  }
}
