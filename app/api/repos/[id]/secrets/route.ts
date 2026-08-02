import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";

type RouteContext = { params: Promise<{ id: string }> };

async function getRepoForUser(repoId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("repos")
    .select("id, user_id, full_name, github_installation_id")
    .eq("id", repoId)
    .eq("user_id", userId)
    .single();
  return data;
}

async function ghFetch<T>(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

/** GET — list repo secrets (names only, GitHub never returns values) */
export async function GET(_req: Request, ctx: RouteContext) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { id } = await ctx.params;
  const repo = await getRepoForUser(id, userId);
  if (!repo) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const token = await getGithubAccessTokenForRepo(repo);
  if (!token)
    return NextResponse.json({ error: "NO_GITHUB_TOKEN" }, { status: 400 });

  const [owner, name] = repo.full_name.split("/");

  try {
    const data = await ghFetch<{
      secrets: { name: string; created_at: string; updated_at: string }[];
    }>(
      token,
      `https://api.github.com/repos/${owner}/${name}/actions/secrets?per_page=100`
    );
    return NextResponse.json(data.secrets || []);
  } catch (err) {
    console.error("Failed to list secrets", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "GITHUB_API_ERROR", detail },
      { status: 502 }
    );
  }
}

/** PUT — create or update a secret */
export async function PUT(req: Request, ctx: RouteContext) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { id } = await ctx.params;
  const repo = await getRepoForUser(id, userId);
  if (!repo) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const token = await getGithubAccessTokenForRepo(repo);
  if (!token)
    return NextResponse.json({ error: "NO_GITHUB_TOKEN" }, { status: 400 });

  const { name, value } = (await req.json()) as {
    name?: string;
    value?: string;
  };
  if (!name?.trim() || !value) {
    return NextResponse.json(
      { error: "name and value are required" },
      { status: 400 }
    );
  }

  const secretName = name
    .trim()
    .toUpperCase()
    .replace(/[^\dA-Z_]/g, "_");
  const [owner, repoName] = repo.full_name.split("/");

  try {
    // Get the repo public key for encrypting the secret
    const pubKey = await ghFetch<{ key_id: string; key: string }>(
      token,
      `https://api.github.com/repos/${owner}/${repoName}/actions/secrets/public-key`
    );

    const encrypted = await encryptSecret(value, pubKey.key);

    const putRes = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/actions/secrets/${secretName}`,
      {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          encrypted_value: encrypted,
          key_id: pubKey.key_id,
        }),
      }
    );
    if (!putRes.ok) {
      const body = await putRes.text();
      throw new Error(`GitHub API (${putRes.status}): ${body}`);
    }

    return NextResponse.json({ ok: true, name: secretName });
  } catch (err) {
    console.error("Failed to set secret", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "GITHUB_API_ERROR", detail },
      { status: 502 }
    );
  }
}

/** DELETE — remove a secret */
export async function DELETE(req: Request, ctx: RouteContext) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { id } = await ctx.params;
  const repo = await getRepoForUser(id, userId);
  if (!repo) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const token = await getGithubAccessTokenForRepo(repo);
  if (!token)
    return NextResponse.json({ error: "NO_GITHUB_TOKEN" }, { status: 400 });

  const { name } = (await req.json()) as { name?: string };
  if (!name)
    return NextResponse.json({ error: "name is required" }, { status: 400 });

  const [owner, repoName] = repo.full_name.split("/");

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/actions/secrets/${name}`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok && res.status !== 404) {
      const body = await res.text();
      throw new Error(`GitHub API (${res.status}): ${body}`);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete secret", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "GITHUB_API_ERROR", detail },
      { status: 502 }
    );
  }
}

/**
 * Encrypt a secret value using the repo's public key.
 * GitHub requires libsodium sealed-box encryption (crypto_box_seal).
 */
async function encryptSecret(
  secretValue: string,
  base64PublicKey: string
): Promise<string> {
  const sodium = await import("libsodium-wrappers");
  await sodium.ready;
  const publicKey = sodium.from_base64(
    base64PublicKey,
    sodium.base64_variants.ORIGINAL
  );
  const messageBytes = sodium.from_string(secretValue);
  const encrypted = sodium.crypto_box_seal(messageBytes, publicKey);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}
