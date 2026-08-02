import { NextResponse } from "next/server";
import { buildAppUrl } from "@/lib/app-url";
import { requireUserId } from "@/lib/auth";
import { createSentryConnectLink } from "@/lib/connections/pipedream-connect";
import {
  getConnectionPreset,
  usesManagedConnectionAuth,
} from "@/lib/connections/presets";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Connection } from "@/lib/types";

type ManagedAuthGetRouteDeps = {
  requireUserId: typeof requireUserId;
  findConnectionById: (
    connectionId: string,
    userId: string
  ) => Promise<Connection | null>;
  getConnectionPreset: typeof getConnectionPreset;
  usesManagedConnectionAuth: typeof usesManagedConnectionAuth;
  createSentryConnectLink: typeof createSentryConnectLink;
  buildAppUrl: typeof buildAppUrl;
};

const defaultManagedAuthGetRouteDeps: ManagedAuthGetRouteDeps = {
  requireUserId,
  findConnectionById: async (connectionId, userId) => {
    const { data, error } = await supabaseAdmin
      .from("connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return (data as Connection | null) ?? null;
  },
  getConnectionPreset,
  usesManagedConnectionAuth,
  createSentryConnectLink,
  buildAppUrl,
};

export function createManagedAuthGetHandler(
  overrides: Partial<ManagedAuthGetRouteDeps> = {}
) {
  const deps: ManagedAuthGetRouteDeps = {
    ...defaultManagedAuthGetRouteDeps,
    ...overrides,
  };

  return async function GET(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get("connectionId");
    if (!connectionId) {
      return NextResponse.json(
        { error: "connectionId required" },
        { status: 400 }
      );
    }

    let connection: Connection | null;
    try {
      connection = await deps.findConnectionById(connectionId, userId);
    } catch (error) {
      console.error("[managed-auth] connection lookup failed", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    const preset = deps.getConnectionPreset(connection.source_preset);
    if (!deps.usesManagedConnectionAuth(preset)) {
      return NextResponse.json(
        { error: "Connection does not use managed auth" },
        { status: 400 }
      );
    }

    try {
      const link = await deps.createSentryConnectLink({
        externalUserId: userId,
        successRedirectUri: deps
          .buildAppUrl("/settings?tab=connections&oauth=success", req)
          .toString(),
        errorRedirectUri: deps
          .buildAppUrl("/settings?tab=connections&oauth=setup_error", req)
          .toString(),
        webhookUri: deps
          .buildAppUrl("/api/connections/managed-auth/webhook", req)
          .toString(),
      });

      return NextResponse.redirect(link.connectLinkUrl);
    } catch (error) {
      console.error("[managed-auth] sentry connect link failed", error);
      return NextResponse.redirect(
        deps
          .buildAppUrl("/settings?tab=connections&oauth=setup_error", req)
          .toString()
      );
    }
  };
}

export const GET = createManagedAuthGetHandler();
