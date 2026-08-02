import { NextResponse } from "next/server";
import {
  type PipedreamConnectionWebhookPayload,
  PipedreamConnectConfigError,
  buildSentryManagedAuthCredentials,
  getPipedreamSentryAppSlug,
  parsePipedreamConnectionWebhookPayload,
  retrievePipedreamAccount,
  verifyPipedreamWebhookSignature,
} from "@/lib/connections/pipedream-connect";
import { getConnectionPreset } from "@/lib/connections/presets";
import { upsertConnectionBySourcePreset } from "@/lib/connections/service";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const MANAGED_AUTH_WEBHOOK_MAX_BODY_BYTES = 500_000;

type ManagedAuthWebhookRouteDeps = {
  verifyPipedreamWebhookSignature: typeof verifyPipedreamWebhookSignature;
  parsePipedreamConnectionWebhookPayload: (
    rawBody: string
  ) => PipedreamConnectionWebhookPayload;
  getPipedreamSentryAppSlug: typeof getPipedreamSentryAppSlug;
  retrievePipedreamAccount: typeof retrievePipedreamAccount;
  buildSentryManagedAuthCredentials: typeof buildSentryManagedAuthCredentials;
  getConnectionPreset: typeof getConnectionPreset;
  upsertConnectionBySourcePreset: typeof upsertConnectionBySourcePreset;
  getUserById: (userId: string) => Promise<boolean>;
};

const defaultManagedAuthWebhookRouteDeps: ManagedAuthWebhookRouteDeps = {
  verifyPipedreamWebhookSignature,
  parsePipedreamConnectionWebhookPayload,
  getPipedreamSentryAppSlug,
  retrievePipedreamAccount,
  buildSentryManagedAuthCredentials,
  getConnectionPreset,
  upsertConnectionBySourcePreset,
  getUserById: async (userId: string) => {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) {
      throw new Error(error.message);
    }
    return Boolean(data.user);
  },
};

export function createManagedAuthWebhookPostHandler(
  overrides: Partial<ManagedAuthWebhookRouteDeps> = {}
) {
  const deps: ManagedAuthWebhookRouteDeps = {
    ...defaultManagedAuthWebhookRouteDeps,
    ...overrides,
  };

  return async function POST(req: Request) {
    const rawBody = await req.text();
    if (
      Buffer.byteLength(rawBody, "utf8") > MANAGED_AUTH_WEBHOOK_MAX_BODY_BYTES
    ) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const signature = req.headers.get("x-pd-signature");

    try {
      deps.verifyPipedreamWebhookSignature(rawBody, signature);
      const payload = deps.parsePipedreamConnectionWebhookPayload(rawBody);

      if (payload.event === "CONNECTION_ERROR") {
        console.error("[managed-auth] sentry connection error", payload.error);
        return NextResponse.json({ ok: true });
      }

      if (!payload.account?.id || !payload.account.external_id) {
        return NextResponse.json(
          {
            error: "Connection success webhook did not include account details",
          },
          { status: 400 }
        );
      }
      if (payload.account.app.name_slug !== deps.getPipedreamSentryAppSlug()) {
        return NextResponse.json(
          { error: "Unexpected Pipedream app for Sentry managed auth" },
          { status: 400 }
        );
      }

      const account = await deps.retrievePipedreamAccount(payload.account.id, {
        includeCredentials: true,
      });
      if (!account.external_id) {
        return NextResponse.json(
          { error: "Connected account did not include an external user id" },
          { status: 400 }
        );
      }
      if (account.external_id !== payload.account.external_id) {
        return NextResponse.json(
          { error: "Connected account user mismatch" },
          { status: 400 }
        );
      }

      // Validate the retrieved Sentry account before any user or connection
      // lookups so unhealthy / dead / wrong-app accounts fail fast.
      const managedAuthCredentials =
        deps.buildSentryManagedAuthCredentials(account);

      const userExists = await deps.getUserById(account.external_id);
      if (!userExists) {
        return NextResponse.json({ error: "Unknown user" }, { status: 400 });
      }

      const preset = deps.getConnectionPreset("sentry");
      if (!preset) {
        throw new Error("Sentry preset not found");
      }

      // The service layer encrypts this broker metadata before writing to
      // connections.encrypted_credentials.
      const oauthAuthorizedAt = account.updated_at || account.created_at;
      const upsertInput = {
        source_preset: preset.id,
        name: preset.name,
        type: "mcp_server" as const,
        auth_type: "oauth",
        auth_header: "Authorization",
        mcp_transport: preset.mcp_transport,
        mcp_url: preset.mcp_url,
        description: preset.description,
        credentials: managedAuthCredentials,
        oauth_client_id: null,
        oauth_authorize_url: null,
        oauth_token_url: null,
        oauth_scopes: account.authorized_scopes?.join(" ") || null,
        oauth_authorized_at: oauthAuthorizedAt,
        oauth_token_expires_at: account.expires_at ?? null,
      } as const;

      await deps.upsertConnectionBySourcePreset(
        account.external_id,
        upsertInput
      );

      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("[managed-auth] sentry webhook failed", error);
      return NextResponse.json(
        {
          error:
            error instanceof PipedreamConnectConfigError
              ? "Server configuration error"
              : "Webhook processing failed",
        },
        { status: 500 }
      );
    }
  };
}

export const POST = createManagedAuthWebhookPostHandler();
