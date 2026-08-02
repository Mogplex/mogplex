import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { normalizeRootDirectory } from "@/lib/repo-settings";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;
  const { id } = await params;

  const body = await req.json();
  const rootDir = normalizeRootDirectory(body.root_directory);
  if (!rootDir) {
    return NextResponse.json(
      { error: "root_directory is required" },
      { status: 400 }
    );
  }

  // Get the parent repo
  const { data: parent, error: parentError } = await supabaseAdmin
    .from("repos")
    .select(
      "id, workspace_id, github_id, github_installation_id, full_name, owner, name, default_branch, vercel_team_id, vercel_project_id, sandbox_billing_target, sandbox_billing_mode_override"
    )
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (parentError || !parent) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("repos")
    .insert({
      user_id: userId,
      workspace_id: parent.workspace_id,
      github_id: parent.github_id,
      github_installation_id: parent.github_installation_id,
      full_name: parent.full_name,
      owner: parent.owner,
      name: parent.name,
      default_branch: parent.default_branch,
      root_directory: rootDir,
      parent_repo_id: parent.id,
      vercel_team_id: parent.vercel_team_id,
      vercel_project_id: parent.vercel_project_id,
      sandbox_billing_target: parent.sandbox_billing_target,
      sandbox_billing_mode_override: parent.sandbox_billing_mode_override,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Space already exists for this path" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
