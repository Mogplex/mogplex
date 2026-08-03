// Public object serving for the Neon storage backend — same URL shape as
// Supabase Storage's public endpoint so stored/derived URLs keep working
// after the cutover. Objects are small (provider icon PNGs); long cache with
// revalidation is fine because icon content is keyed by provider slug and
// re-synced in place.
import { NextResponse } from "next/server";
import { getNeonPool } from "@/lib/db/pool";

const NAME_PATTERN = /^[\w][\w./-]*$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const { bucket, path } = await params;
  const name = path.join("/");
  if (!NAME_PATTERN.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const { rows } = await getNeonPool().query(
    `select content_type, data from storage_objects where bucket = $1 and name = $2`,
    [bucket, name]
  );
  const object = rows[0];
  if (!object) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(object.data as Buffer), {
    status: 200,
    headers: {
      "content-type": String(object.content_type),
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
