import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { validateControlSessionRepoAccess } from "@/lib/control/session-repo-access";
import { redactSecretsInValue } from "@/lib/ai-telemetry";
import { isUuid } from "@/lib/uuid";

type ConversationRecord = {
  id: string;
  user_id: string;
  repo_id: string | null;
  workspace_session_id: string | null;
  sandbox_id: string | null;
  updated_at: string | null;
  [key: string]: unknown;
};

async function getConversationRecord(id: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ConversationRecord | null;
}

async function validateRepoAccess(input: {
  request: Request;
  userId: string;
  repoId: unknown;
}) {
  const result = await validateControlSessionRepoAccess(input);
  if (!result.ok) {
    return {
      response: NextResponse.json(
        { error: result.error },
        { status: result.status }
      ),
    } as const;
  }
  return { value: result.value } as const;
}

function parseWorkspaceSessionId(value: unknown) {
  if (value === undefined) return { ok: true, value: undefined } as const;
  if (value === null) return { ok: true, value: null } as const;
  if (typeof value !== "string" || value.trim().length > 200) {
    return { ok: false } as const;
  }
  return { ok: true, value: value.trim() || null } as const;
}

function parseSandboxId(value: unknown) {
  if (value === undefined) return { ok: true, value: undefined } as const;
  if (value === null) return { ok: true, value: null } as const;
  if (typeof value !== "string") return { ok: false } as const;
  const trimmed = value.trim();
  if (!isUuid(trimmed)) return { ok: false } as const;
  return { ok: true, value: trimmed } as const;
}

async function validateSandboxBinding(input: {
  sandboxId: string | null | undefined;
  repoId: string | null;
  userId: string;
}) {
  if (input.sandboxId === undefined) {
    return { value: undefined } as const;
  }
  if (input.sandboxId === null) {
    return { value: null } as const;
  }
  if (!input.repoId) {
    return {
      response: NextResponse.json(
        { error: "A projectless conversation cannot use a sandbox" },
        { status: 400 }
      ),
    } as const;
  }

  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select("id, repo_id")
    .eq("id", input.sandboxId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) {
    return {
      response: NextResponse.json(
        { error: "Could not validate the conversation sandbox" },
        { status: 500 }
      ),
    } as const;
  }
  if (data?.repo_id !== input.repoId) {
    return {
      response: NextResponse.json(
        { error: "Conversation sandbox not found" },
        { status: 404 }
      ),
    } as const;
  }
  return { value: data.id as string } as const;
}

export function pickConversationMutableFields(body: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  if (typeof body.model === "string" && body.model.trim()) {
    fields.model = body.model.trim();
  }
  if (body.mode === "AUTO" || body.mode === "YOLO" || body.mode === "SAFE") {
    fields.mode = body.mode;
  }
  if (Array.isArray(body.messages)) {
    fields.messages = redactSecretsInValue(body.messages);
  }
  if (Array.isArray(body.local_msgs)) {
    fields.local_msgs = redactSecretsInValue(body.local_msgs);
  }
  if (
    body.harness_state &&
    typeof body.harness_state === "object" &&
    !Array.isArray(body.harness_state)
  ) {
    fields.harness_state = body.harness_state;
  }
  if (
    body.title === null ||
    (typeof body.title === "string" && body.title.length <= 200)
  ) {
    fields.title = body.title || null;
  }
  return fields;
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    let data: ConversationRecord | null;
    try {
      data = await getConversationRecord(id, userId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Load failed" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (data.repo_id) {
      const access = await validateRepoAccess({
        request: req,
        userId,
        repoId: data.repo_id,
      });
      if ("response" in access) return access.response;
    }
    return NextResponse.json(data);
  }

  const repoId = searchParams.get("repo_id");
  const projectless = searchParams.get("projectless") === "true";
  let query = supabaseAdmin
    .from("conversations")
    .select(
      "id, user_id, repo_id, workspace_session_id, model, mode, title, created_at, updated_at"
    )
    .eq("user_id", userId);

  if (repoId) {
    const access = await validateRepoAccess({
      request: req,
      userId,
      repoId,
    });
    if ("response" in access) return access.response;
    query = query.eq("repo_id", access.value);
  } else if (projectless) {
    query = query.is("repo_id", null);
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data || []);
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const expectedUpdatedAt = body.expected_updated_at;
  if (!id || id.length > 200) {
    return NextResponse.json(
      { error: "Missing or invalid id" },
      { status: 400 }
    );
  }
  if (
    expectedUpdatedAt !== undefined &&
    expectedUpdatedAt !== null &&
    typeof expectedUpdatedAt !== "string"
  ) {
    return NextResponse.json(
      { error: "Invalid expected_updated_at" },
      { status: 400 }
    );
  }
  const workspaceSessionId = parseWorkspaceSessionId(body.workspace_session_id);
  if (!workspaceSessionId.ok) {
    return NextResponse.json(
      { error: "Invalid workspace_session_id" },
      { status: 400 }
    );
  }
  const sandboxId = parseSandboxId(body.sandbox_id);
  if (!sandboxId.ok) {
    return NextResponse.json({ error: "Invalid sandbox_id" }, { status: 400 });
  }

  const fields = pickConversationMutableFields(body);
  const updatedAt = new Date().toISOString();

  if (typeof expectedUpdatedAt === "string" && expectedUpdatedAt) {
    let current: ConversationRecord | null;
    try {
      current = await getConversationRecord(id, userId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Load failed" },
        { status: 500 }
      );
    }
    if (!current) {
      return NextResponse.json(
        { error: "CONFLICT", conversation: null },
        { status: 409 }
      );
    }
    if (
      Object.hasOwn(body, "repo_id") &&
      (body.repo_id ?? null) !== current.repo_id
    ) {
      return NextResponse.json(
        { error: "Conversation repository cannot be changed" },
        { status: 400 }
      );
    }
    if (
      workspaceSessionId.value !== undefined &&
      workspaceSessionId.value !== current.workspace_session_id
    ) {
      return NextResponse.json(
        { error: "Conversation workspace cannot be changed" },
        { status: 400 }
      );
    }

    const sandboxBinding = await validateSandboxBinding({
      sandboxId: sandboxId.value,
      repoId: current.repo_id,
      userId,
    });
    if ("response" in sandboxBinding) return sandboxBinding.response;
    const sandboxFields =
      sandboxBinding.value === undefined
        ? {}
        : { sandbox_id: sandboxBinding.value };

    const { data, error } = await supabaseAdmin
      .from("conversations")
      .update({
        ...fields,
        ...sandboxFields,
        updated_at: updatedAt,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("updated_at", expectedUpdatedAt)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      const latest = await getConversationRecord(id, userId);
      return NextResponse.json(
        { error: "CONFLICT", conversation: latest },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, conversation: data });
  }

  const repoAccess = await validateRepoAccess({
    request: req,
    userId,
    repoId: body.repo_id ?? null,
  });
  if ("response" in repoAccess) return repoAccess.response;
  const sandboxBinding = await validateSandboxBinding({
    sandboxId: sandboxId.value ?? null,
    repoId: repoAccess.value,
    userId,
  });
  if ("response" in sandboxBinding) return sandboxBinding.response;

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .insert({
      id,
      user_id: userId,
      repo_id: repoAccess.value,
      workspace_session_id: workspaceSessionId.value ?? null,
      sandbox_id: sandboxBinding.value ?? null,
      ...fields,
      updated_at: updatedAt,
    })
    .select("*")
    .maybeSingle();

  if (error?.code === "23505") {
    const current = await getConversationRecord(id, userId);
    return NextResponse.json(
      { error: "CONFLICT", conversation: current },
      { status: 409 }
    );
  }
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to save conversation" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, conversation: data });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
