import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { validateControlSessionRepoAccess } from "@/lib/control/session-repo-access";
import { pickControlSessionUpdateFields } from "@/lib/control/session-update";
import { createOrchestrationRun } from "@/lib/orchestrations/store";
import { validateOrchestrationBranchName } from "@/lib/orchestrations/validation";
import { redactSecretsInValue } from "@/lib/ai-telemetry";
import { parseControlSessionModelId } from "@/lib/control/session-model";
import { mergePersistedControlMessages } from "@/lib/control/transcript-store";
import { validateControlChatMessages } from "../chat/_lib/messages";

const LIST_COLUMNS =
  "id, title, project, repo_id, model_id, orchestration_run_id, pinned, archived, created_at, updated_at";

async function getSessionRecord(
  id: string,
  userId: string,
  client = supabaseAdmin
) {
  const { data, error } = await client
    .from("control_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const data = await getSessionRecord(id, userId);
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await supabaseAdmin
    .from("control_sessions")
    .select(LIST_COLUMNS)
    .eq("user_id", userId)
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    project?: string | null;
    repo_id?: unknown;
    model_id?: unknown;
    request?: string;
  };
  const modelId = parseControlSessionModelId(body.model_id);
  if (!modelId.ok) {
    return NextResponse.json({ error: "Invalid model_id" }, { status: 400 });
  }
  const repoAccess = await validateControlSessionRepoAccess({
    request: req,
    userId,
    repoId: body.repo_id,
  });
  if (!repoAccess.ok) {
    return NextResponse.json(
      { error: repoAccess.error },
      { status: repoAccess.status }
    );
  }
  const { data: repo, error: repoError } = repoAccess.value
    ? await supabaseAdmin
        .from("repos")
        .select("default_branch")
        .eq("id", repoAccess.value)
        .single()
    : { data: null, error: null };
  if (repoError) {
    return NextResponse.json(
      { error: "Failed to load repository" },
      { status: 500 }
    );
  }
  const baseBranch = validateOrchestrationBranchName(
    repo?.default_branch?.trim() || "main"
  );
  if (!baseBranch.ok) {
    return NextResponse.json({ error: baseBranch.error }, { status: 400 });
  }

  const { data: session, error } = await supabaseAdmin
    .from("control_sessions")
    .insert({
      user_id: userId,
      title: body.title?.trim() || "New session",
      project: body.project?.trim().slice(0, 160) || null,
      repo_id: repoAccess.value,
      model_id: modelId.value,
    })
    .select("*")
    .single();

  if (error || !session) {
    return NextResponse.json(
      { error: error?.message || "Failed to create session" },
      { status: 500 }
    );
  }

  if (!repoAccess.value) return NextResponse.json(session);

  let createdRunId: string | null = null;
  try {
    const run = await createOrchestrationRun({
      userId,
      repoId: repoAccess.value,
      title: session.title,
      request: body.request?.trim() || session.title,
      baseBranch: baseBranch.value,
    });
    createdRunId = run.id;
    const { data: linked, error: linkError } = await supabaseAdmin
      .from("control_sessions")
      .update({ orchestration_run_id: run.id })
      .eq("id", session.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (linkError || !linked) {
      throw new Error(linkError?.message || "Failed to link orchestration run");
    }
    return NextResponse.json(linked);
  } catch (runError) {
    const sessionCleanup = await Promise.resolve(
      supabaseAdmin
        .from("control_sessions")
        .delete()
        .eq("id", session.id)
        .eq("user_id", userId)
    ).catch((error: unknown) => ({ error }));
    const runCleanup = createdRunId
      ? await Promise.resolve(
          supabaseAdmin
            .from("orchestration_runs")
            .delete()
            .eq("id", createdRunId)
            .eq("user_id", userId)
        ).catch((error: unknown) => ({ error }))
      : { error: null };
    if (sessionCleanup.error || runCleanup.error) {
      console.error("[control/sessions] mission rollback was incomplete", {
        sessionId: session.id,
        runId: createdRunId,
        sessionError: sessionCleanup.error,
        runError: runCleanup.error,
      });
    }
    console.error("[control/sessions] failed to create mission run", runError);
    return NextResponse.json(
      { error: "Failed to create mission" },
      { status: 500 }
    );
  }
}

const defaultPutDeps = { requireUserId, client: supabaseAdmin };

export function createControlSessionsPutHandler(deps = defaultPutDeps) {
  return async function PUT(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = (await req.json().catch(() => null)) as {
      id?: string;
      expected_updated_at?: string | null;
      title?: string;
      project?: string | null;
      repo_id?: unknown;
      model_id?: unknown;
      messages?: unknown;
      pinned?: boolean;
      archived?: boolean;
    } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (Object.hasOwn(body, "model_id")) {
      const modelId = parseControlSessionModelId(body.model_id);
      if (!modelId.ok) {
        return NextResponse.json(
          { error: "Invalid model_id" },
          { status: 400 }
        );
      }
      body.model_id = modelId.value;
    }
    if (Object.hasOwn(body, "repo_id")) {
      const repoAccess = await validateControlSessionRepoAccess({
        request: req,
        userId,
        repoId: body.repo_id,
      });
      if (!repoAccess.ok) {
        return NextResponse.json(
          { error: repoAccess.error },
          { status: repoAccess.status }
        );
      }
      body.repo_id = repoAccess.value;
    }
    const { id, expected_updated_at: expectedUpdatedAt } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    if (!expectedUpdatedAt) {
      return NextResponse.json(
        { error: "Missing expected_updated_at" },
        { status: 400 }
      );
    }

    const fields = pickControlSessionUpdateFields(body);
    if (Object.hasOwn(fields, "messages")) {
      const current = await getSessionRecord(id, userId, deps.client);
      if (!current || current.archived) {
        return NextResponse.json(
          { error: "CONFLICT", session: current },
          { status: 409 }
        );
      }
      try {
        const incoming = await validateControlChatMessages(
          fields.messages as Parameters<typeof validateControlChatMessages>[0]
        );
        const saved = await validateControlChatMessages(current.messages ?? []);
        fields.messages = redactSecretsInValue(
          mergePersistedControlMessages(saved, incoming)
        );
      } catch {
        return NextResponse.json(
          { error: "Invalid Control messages" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await deps.client
      .from("control_sessions")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("updated_at", expectedUpdatedAt)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      const current = await getSessionRecord(id, userId, deps.client);
      return NextResponse.json(
        { error: "CONFLICT", session: current },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, session: data });
  };
}

export const PUT = createControlSessionsPutHandler();

async function deleteOwnedSession(id: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("control_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

type ControlSessionDeleteDeps = {
  requireUserId: typeof requireUserId;
  deleteOwnedSession: typeof deleteOwnedSession;
};

const defaultDeleteDeps: ControlSessionDeleteDeps = {
  requireUserId,
  deleteOwnedSession,
};

export function createControlSessionDeleteHandler(
  overrides: Partial<ControlSessionDeleteDeps> = {}
) {
  const deps = { ...defaultDeleteDeps, ...overrides };
  return async function DELETE(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    try {
      const data = await deps.deleteOwnedSession(id, userId);
      if (!data) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id: data.id });
    } catch (error) {
      console.error("[control/sessions] failed to delete chat", error);
      return NextResponse.json(
        { error: "Failed to delete chat" },
        { status: 500 }
      );
    }
  };
}

export const DELETE = createControlSessionDeleteHandler();
