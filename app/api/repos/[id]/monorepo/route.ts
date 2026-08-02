import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { detectMonorepoStructure } from "@/lib/monorepo-detection";
import { getOAuthToken } from "@/lib/oauth-tokens";

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
    .single();

  if (error || !repo) {
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
    await supabaseAdmin
      .from("repos")
      .update({ is_monorepo: true })
      .eq("id", id);
  }

  // Include which paths already have spaces
  const { data: existing } = await supabaseAdmin
    .from("repos")
    .select("root_directory")
    .eq("user_id", userId)
    .eq("github_id", repo.github_id)
    .not("root_directory", "is", null);

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
