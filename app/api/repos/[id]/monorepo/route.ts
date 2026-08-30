import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { detectMonorepoStructure } from "@/lib/monorepo-detection";
import { getOAuthToken } from "@/lib/oauth-tokens";

type PersistenceResult = { error: { message: string } | null };

async function updateMonorepoFlag(repoId: string): Promise<PersistenceResult> {
  const { error } = await supabaseAdmin
    .from("repos")
    .update({ is_monorepo: true })
    .eq("id", repoId);
  return { error: error ? { message: error.message } : null };
}

export async function persistMonorepoDetection(
  repoId: string,
  update: (repoId: string) => Promise<PersistenceResult> = updateMonorepoFlag
) {
  const { error } = await update(repoId);
  if (error) {
    throw new Error("Failed to save detected repository structure", {
      cause: error,
    });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const { id } = await params;

  const { data: repo, error } = await supabaseAdmin
    .from("repos")
    .select("id, full_name, default_branch, github_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load repository" },
      { status: 500 }
    );
  }
  if (!repo) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const githubToken = await getOAuthToken(userId, "github");

  if (!githubToken) {
    return NextResponse.json(
      { error: "GitHub token required" },
      { status: 400 }
    );
  }

  const structure = await detectMonorepoStructure(
    repo.full_name,
    githubToken,
    repo.default_branch
  );

  if (structure.is_monorepo) {
    try {
      await persistMonorepoDetection(id);
    } catch (persistError) {
      return NextResponse.json(
        {
          error:
            persistError instanceof Error
              ? persistError.message
              : "Failed to save detected repository structure",
        },
        { status: 500 }
      );
    }
  }

  // Include which paths already have spaces
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("repos")
    .select("root_directory")
    .eq("user_id", userId)
    .eq("github_id", repo.github_id)
    .not("root_directory", "is", null);
  if (existingError) {
    return NextResponse.json(
      { error: "Failed to load existing repository paths" },
      { status: 500 }
    );
  }

  const existingPaths = new Set(
    (existing || []).map((r) => r.root_directory as string)
  );

  return NextResponse.json({
    ...structure,
    workspaces: structure.workspaces.map((ws) => ({
      ...ws,
      has_space: existingPaths.has(ws.path),
    })),
  });
}
