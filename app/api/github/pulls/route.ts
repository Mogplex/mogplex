import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { getGithubAccessTokenForRepo } from "@/lib/github-access";

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(request.url);
  const repoIdParam = searchParams.get("repo_id");
  const prParam = searchParams.get("pr");

  let repoQuery = supabaseAdmin
    .from("repos")
    .select("id, full_name, user_id, github_installation_id")
    .eq("user_id", userId)
    .eq("is_hidden", false);

  if (repoIdParam) {
    repoQuery = repoQuery.eq("id", repoIdParam);
  }

  const { data: repos } = await repoQuery.limit(1);

  const repo = repos?.[0];
  if (!repo) return NextResponse.json({ pulls: [], diff: null });

  const token = await getGithubAccessTokenForRepo(repo);
  if (!token) return NextResponse.json({ pulls: [], diff: null });

  const parts = repo.full_name.split("/");
  if (parts.length !== 2) return NextResponse.json({ pulls: [], diff: null });
  const [owner, name] = parts;

  try {
    const pullsRes = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls?state=open&sort=updated&direction=desc&per_page=5`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!pullsRes.ok) return NextResponse.json({ pulls: [], diff: null });

    const pulls = await pullsRes.json();
    if (pulls.length === 0) return NextResponse.json({ pulls: [], diff: null });

    const prNumber = prParam ? Number.parseInt(prParam) : pulls[0]?.number;
    if (!prNumber) return NextResponse.json({ pulls: [], diff: null });

    const diffRes = await fetch(
      `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3.diff",
        },
      }
    );

    const diff = diffRes.ok ? await diffRes.text() : null;

    return NextResponse.json({
      pulls: pulls.map(
        (p: {
          number: number;
          title: string;
          state: string;
          html_url: string;
          user: { login: string };
          additions: number;
          deletions: number;
          changed_files: number;
        }) => ({
          number: p.number,
          title: p.title,
          state: p.state,
          html_url: p.html_url,
          user: { login: p.user.login },
          additions: p.additions,
          deletions: p.deletions,
          changed_files: p.changed_files,
        })
      ),
      diff,
    });
  } catch (err) {
    console.error("GitHub pulls fetch failed:", err);
    return NextResponse.json({ pulls: [], diff: null });
  }
}
