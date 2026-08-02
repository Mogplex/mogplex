import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireProfileId } from "@/lib/auth";
import { loadTeamMembershipAuth } from "@/lib/team-management";
import { recordTeamAuditEvent } from "@/lib/team-audit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TEAM_ICONS_BUCKET, teamIconUrlFromPath } from "@/lib/team-icons";

const MAX_BYTES = 2 * 1024 * 1024;

type ImageFormat = {
  mime: string;
  ext: string;
  matches: (hexHead: string) => boolean;
};

// Raster-only allow-list. SVG is intentionally excluded — it can carry
// inline <script>/event handlers and serving image/svg+xml from a public
// CDN is a stored-XSS vector. Each format is matched by magic bytes, NOT by
// the client-supplied Content-Type, so a request claiming "image/png" with
// HTML or SVG bytes is rejected.
//
// `hexHead` is a lowercase hex string of the first 16 bytes of the upload.
const IMAGE_FORMATS: readonly ImageFormat[] = [
  {
    mime: "image/png",
    ext: "png",
    matches: (h) => h.startsWith("89504e470d0a1a0a"),
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    matches: (h) => h.startsWith("ffd8ff"),
  },
  {
    mime: "image/gif",
    ext: "gif",
    // "GIF87a" or "GIF89a"
    matches: (h) =>
      h.startsWith("474946383761") || h.startsWith("474946383961"),
  },
  {
    mime: "image/webp",
    ext: "webp",
    // "RIFF????WEBP" — RIFF header (4 bytes) + size (4 bytes) + "WEBP".
    matches: (h) => h.startsWith("52494646") && h.slice(16, 24) === "57454250",
  },
];

function detectFormat(buffer: Buffer): ImageFormat | null {
  const hexHead = buffer.subarray(0, 16).toString("hex");
  for (const format of IMAGE_FORMATS) {
    if (format.matches(hexHead)) return format;
  }
  return null;
}

type TeamIconRow = { icon_path: string | null };

async function loadCurrentIcon(teamId: string): Promise<TeamIconRow | null> {
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("icon_path")
    .eq("id", teamId)
    .maybeSingle();
  if (error || !data) return null;
  return data as TeamIconRow;
}

async function removeStorageObject(path: string | null) {
  if (!path) return;
  // Best-effort: failure here leaves an orphan storage object but does not
  // affect correctness of the team row. A future sweep job should reconcile
  // bucket contents against teams.icon_path.
  const { error } = await supabaseAdmin.storage
    .from(TEAM_ICONS_BUCKET)
    .remove([path]);
  if (error) {
    console.error("[team-icon] failed to remove storage object", {
      path,
      error: error.message,
    });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 2 MB)" },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const format = detectFormat(buffer);
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported image type (PNG, JPEG, WEBP, or GIF only)" },
      { status: 415 }
    );
  }

  const previous = await loadCurrentIcon(teamId);

  // Random UUID suffix prevents collisions on concurrent uploads from the
  // same team in the same millisecond (upsert: false would 500 the second
  // caller otherwise).
  const path = `${teamId}/${Date.now()}-${randomUUID().slice(0, 8)}.${format.ext}`;
  const uploadResult = await supabaseAdmin.storage
    .from(TEAM_ICONS_BUCKET)
    .upload(path, buffer, {
      contentType: format.mime,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadResult.error) {
    console.error("[team-icon] upload failed", uploadResult.error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { error: updateError } = await supabaseAdmin
    .from("teams")
    .update({ icon_path: path })
    .eq("id", teamId);

  if (updateError) {
    // Roll back the just-uploaded object so we don't leak orphans.
    await removeStorageObject(path);
    console.error("[team-icon] db update failed", updateError);
    return NextResponse.json({ error: "Failed to save icon" }, { status: 500 });
  }

  if (previous?.icon_path && previous.icon_path !== path) {
    await removeStorageObject(previous.icon_path);
  }

  await recordTeamAuditEvent({
    productTeamId: teamId,
    actorUserId: profileId,
    action: "team.icon.updated",
    targetType: "team",
    targetId: teamId,
    payload: { icon_path: path },
  });

  return NextResponse.json({ icon_url: teamIconUrlFromPath(path) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ teamId: string }> }
) {
  const profileId = await requireProfileId();
  if (profileId instanceof Response) return profileId;

  const { teamId } = await context.params;
  const auth = await loadTeamMembershipAuth(teamId, profileId);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const previous = await loadCurrentIcon(teamId);

  const { error: updateError } = await supabaseAdmin
    .from("teams")
    .update({ icon_path: null })
    .eq("id", teamId);
  if (updateError) {
    console.error("[team-icon] db clear failed", updateError);
    return NextResponse.json(
      { error: "Failed to remove icon" },
      { status: 500 }
    );
  }

  await removeStorageObject(previous?.icon_path ?? null);

  await recordTeamAuditEvent({
    productTeamId: teamId,
    actorUserId: profileId,
    action: "team.icon.removed",
    targetType: "team",
    targetId: teamId,
    payload: { icon_path: previous?.icon_path ?? null },
  });

  return NextResponse.json({ icon_url: null });
}
