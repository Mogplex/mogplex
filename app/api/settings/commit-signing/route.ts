/**
 * Commit signing settings for the signed-in user.
 *
 * GET    -> the current signing key status (never the private key)
 * POST   -> generate, import, or register a signing key
 * DELETE -> revoke the signing key
 *
 * The private key never leaves the server: it is encrypted before it is
 * stored and only the public key and fingerprint are returned.
 */
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/api/parse-json-body";
import { requireUserId } from "@/lib/auth";
import { getOAuthToken } from "@/lib/oauth-tokens";
import {
  generateCommitSigningKeyPair,
  readImportablePrivateKey,
} from "@/lib/commit-signing/key-material";
import { isCommitSigningEncryptionConfigured } from "@/lib/commit-signing/secret-box";
import {
  deleteCommitSigningKey,
  getCommitSigningKeyView,
  markCommitSigningKeyRegistered,
  saveCommitSigningKey,
  type CommitSigningKeyView,
} from "@/lib/commit-signing/storage";
import { registerGithubSshSigningKey } from "@/lib/commit-signing/github";

const DEFAULT_KEY_TITLE = "Mogplex commit signing";

type CommitSigningAction = "generate" | "import" | "register";

type CommitSigningPostBody = {
  action?: CommitSigningAction;
  privateKey?: string;
  title?: string;
  registerWithGithub?: boolean;
};

export type CommitSigningRouteDeps = {
  requireUserId: typeof requireUserId;
  loadKey: typeof getCommitSigningKeyView;
  saveKey: typeof saveCommitSigningKey;
  deleteKey: typeof deleteCommitSigningKey;
  markRegistered: typeof markCommitSigningKeyRegistered;
  isEncryptionConfigured: typeof isCommitSigningEncryptionConfigured;
  getGithubToken: (userId: string) => Promise<string | null>;
  registerKey: typeof registerGithubSshSigningKey;
};

const defaultDeps: CommitSigningRouteDeps = {
  requireUserId,
  loadKey: getCommitSigningKeyView,
  saveKey: saveCommitSigningKey,
  deleteKey: deleteCommitSigningKey,
  markRegistered: markCommitSigningKeyRegistered,
  isEncryptionConfigured: isCommitSigningEncryptionConfigured,
  getGithubToken: (userId: string) => getOAuthToken(userId, "github"),
  registerKey: registerGithubSshSigningKey,
};

function statusPayload(view: CommitSigningKeyView | null) {
  if (!view) {
    return {
      available: true,
      configured: false,
      publicKey: null,
      fingerprint: null,
      title: null,
      registered: false,
      registeredAt: null,
      githubKeyId: null,
      createdAt: null,
    };
  }
  return {
    available: true,
    configured: true,
    publicKey: view.publicKey,
    fingerprint: view.fingerprint,
    title: view.title,
    registered: view.registeredAt !== null,
    registeredAt: view.registeredAt,
    githubKeyId: view.githubKeyId,
    createdAt: view.createdAt,
  };
}

type CommitSigningRouteOverrides = {
  [K in keyof CommitSigningRouteDeps]?: CommitSigningRouteDeps[K];
};

export function createCommitSigningRouteHandlers(
  overrides: CommitSigningRouteOverrides = {}
) {
  const deps: CommitSigningRouteDeps = {
    ...defaultDeps,
    ...overrides,
  };

  async function registerWithGithub(
    userId: string,
    view: CommitSigningKeyView
  ) {
    let token: string | null;
    try {
      token = await deps.getGithubToken(userId);
    } catch {
      token = null;
    }
    const title = view.title ?? DEFAULT_KEY_TITLE;
    if (!token) {
      return NextResponse.json(
        {
          error:
            "Connect your GitHub account to register the signing key automatically.",
          manualRegistrationRequired: true,
          publicKey: view.publicKey,
        },
        { status: 409 }
      );
    }
    const result = await deps.registerKey({
      token,
      publicKey: view.publicKey,
      title,
    });
    if (
      result.status === "registered" ||
      result.status === "already_registered"
    ) {
      await deps.markRegistered({
        userId,
        githubKeyId: result.keyId,
        title,
      });
      return NextResponse.json({
        ...statusPayload(await deps.loadKey(userId)),
        registration: result.status,
      });
    }
    if (result.status === "scope_missing") {
      return NextResponse.json(
        {
          error:
            "This GitHub token cannot manage SSH signing keys. Add the public key to GitHub under Settings -> SSH and GPG keys -> Signing keys.",
          manualRegistrationRequired: true,
          publicKey: view.publicKey,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.message }, { status: 502 });
  }
  async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    if (!deps.isEncryptionConfigured()) {
      return NextResponse.json(
        {
          available: false,
          configured: false,
          publicKey: null,
          fingerprint: null,
          title: null,
          registered: false,
          registeredAt: null,
          githubKeyId: null,
          createdAt: null,
          error:
            "Commit signing is not configured on this deployment. Ask an administrator to set MOGPLEX_COMMIT_SIGNING_KEY_ENCRYPTION_KEY.",
        },
        { status: 503 }
      );
    }
    const view = await deps.loadKey(userId);
    return NextResponse.json(statusPayload(view));
  }

  async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    if (!deps.isEncryptionConfigured()) {
      return NextResponse.json(
        { error: "Commit signing is not configured on this deployment." },
        { status: 503 }
      );
    }
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as CommitSigningPostBody;
    const action = body.action;

    if (action === "generate") {
      const pair = generateCommitSigningKeyPair();
      const title = body.title?.trim() || DEFAULT_KEY_TITLE;
      await deps.saveKey({
        userId,
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        fingerprint: pair.fingerprint,
        title,
      });
      const view = await deps.loadKey(userId);
      if (body.registerWithGithub && view) {
        return registerWithGithub(userId, view);
      }
      return NextResponse.json(statusPayload(view));
    }

    if (action === "import") {
      const armored = body.privateKey?.replace(/\r\n/g, "\n").trim();
      if (!armored) {
        return NextResponse.json(
          { error: "Paste the private key to import." },
          { status: 400 }
        );
      }
      let parsedKey: { publicKey: string; fingerprint: string };
      try {
        parsedKey = readImportablePrivateKey(armored);
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "That private key could not be read.",
          },
          { status: 400 }
        );
      }
      const title = body.title?.trim() || DEFAULT_KEY_TITLE;
      await deps.saveKey({
        userId,
        privateKey: `${armored}\n`,
        publicKey: parsedKey.publicKey,
        fingerprint: parsedKey.fingerprint,
        title,
      });
      const view = await deps.loadKey(userId);
      if (body.registerWithGithub && view) {
        return registerWithGithub(userId, view);
      }
      return NextResponse.json(statusPayload(view));
    }

    if (action === "register") {
      const view = await deps.loadKey(userId);
      if (!view) {
        return NextResponse.json(
          { error: "Create a signing key first." },
          { status: 404 }
        );
      }
      return registerWithGithub(userId, view);
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  async function DELETE() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    await deps.deleteKey(userId);
    return NextResponse.json(statusPayload(null));
  }

  return { GET, POST, DELETE };
}

const handlers = createCommitSigningRouteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
