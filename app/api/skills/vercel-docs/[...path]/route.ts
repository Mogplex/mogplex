import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const docPath = path.join("/");
    const url = `https://vercel.com/docs/${docPath}.md`;

    const res = await fetch(url, {
      headers: { "User-Agent": "MOGPLEX/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch doc: ${res.status}` },
        { status: res.status }
      );
    }

    const markdown = await res.text();

    // Extract title from first heading
    const titleMatch = /^#\s+(.+)$/m.exec(markdown);
    const title = titleMatch
      ? titleMatch[1]
      : docPath.split("/").pop()?.replace(/-/g, " ") || docPath;

    return NextResponse.json(
      { title, path: docPath, markdown },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
