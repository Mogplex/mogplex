import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { AGENT_CATEGORIES, PRECONFIGURED_AGENTS } from "@/lib/agents/templates";
import { resolveStoredUserDefaultModelId } from "@/lib/models/default-model";
import { readActiveTeamIdHeader } from "@/lib/team-capabilities";
import { validateAgentInput } from "@/lib/agents/validation";
import {
  AGENT_CREATE_FIELDS,
  AGENT_UPDATE_FIELDS,
  pickAgentFields,
} from "@/lib/agents/input-sanitizer";
import { isTeamMember } from "@/lib/agents/runtime/store";
import {
  AgentLinkValidationError,
  deleteOwnedAgent,
  insertAgent,
  listAgentsForScope,
  loadAgentById,
  loadAgentLinks,
  replaceAgentLinks,
  updateAgent,
  type AgentLinks,
  type AgentRow,
} from "./_lib/store";

const BUILT_IN_CATEGORY_SLUGS = new Set(Object.keys(AGENT_CATEGORIES));

type CategoryCheckError = { message: string; status: 400 | 500 };

async function ensureCategoryAllowed(
  userId: string,
  category: string | undefined
): Promise<CategoryCheckError | null> {
  if (!category) return null;
  if (BUILT_IN_CATEGORY_SLUGS.has(category)) return null;
  const { data, error } = await supabaseAdmin
    .from("agent_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", category)
    .maybeSingle();
  if (error) return { message: error.message, status: 500 };
  if (!data) return { message: "Invalid category", status: 400 };
  return null;
}

export type AgentsRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveDefaultModel: (
    userId: string,
    teamId: string | null
  ) => Promise<string | null>;
  ensureCategoryAllowed: typeof ensureCategoryAllowed;
  isTeamMember: (teamId: string, userId: string) => Promise<boolean>;
  listAgents: typeof listAgentsForScope;
  loadAgent: typeof loadAgentById;
  loadLinks: typeof loadAgentLinks;
  replaceLinks: typeof replaceAgentLinks;
  insertAgent: typeof insertAgent;
  updateAgent: typeof updateAgent;
  deleteAgent: typeof deleteOwnedAgent;
};

const defaultDeps: AgentsRouteDeps = {
  requireUserId,
  resolveDefaultModel: (userId, teamId) =>
    resolveStoredUserDefaultModelId(userId, {
      surface: "agents",
      teamId,
    }).catch(() => null),
  ensureCategoryAllowed,
  isTeamMember,
  listAgents: listAgentsForScope,
  loadAgent: loadAgentById,
  loadLinks: loadAgentLinks,
  replaceLinks: replaceAgentLinks,
  insertAgent,
  updateAgent,
  deleteAgent: deleteOwnedAgent,
};

type AgentWriteExtras = {
  teamId: string | null | undefined;
  skillIds: string[] | undefined;
  ruleIds: string[] | undefined;
  error: string | null;
};

type IdListRead = { ids?: string[]; error?: string };

function readIdList(value: unknown, label: string): IdListRead {
  if (value === undefined) return {};
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) {
    return { error: `${label} must be a list of ids` };
  }
  return { ids: value as string[] };
}

/** Sharing and attachment fields sit next to the sanitized column fields. */
function readWriteExtras(body: unknown): AgentWriteExtras {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  let teamId: string | null | undefined;
  let teamError: string | null = null;
  if (record.team_id === null) teamId = null;
  else if (typeof record.team_id === "string" && record.team_id.trim()) {
    teamId = record.team_id.trim();
  } else if (record.team_id !== undefined) {
    teamError = "team_id must be a team id or null";
  }
  const skills = readIdList(record.skill_ids, "skill_ids");
  const rules = readIdList(record.rule_ids, "rule_ids");
  return {
    teamId,
    skillIds: skills.ids,
    ruleIds: rules.ids,
    error: teamError ?? skills.error ?? rules.error ?? null,
  };
}

function presentAgent(row: AgentRow, userId: string, links?: AgentLinks) {
  return {
    ...row,
    team_id: row.team_id ?? null,
    shared: Boolean(row.team_id),
    owned: row.user_id === userId,
    skill_ids: links?.skill_ids ?? [],
    rule_ids: links?.rule_ids ?? [],
  };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function applyLinks(
  deps: AgentsRouteDeps,
  input: { agentId: string; userId: string; extras: AgentWriteExtras }
) {
  if (!input.extras.skillIds && !input.extras.ruleIds) return null;
  try {
    await deps.replaceLinks({
      agentId: input.agentId,
      userId: input.userId,
      skillIds: input.extras.skillIds,
      ruleIds: input.extras.ruleIds,
    });
    return null;
  } catch (error) {
    if (error instanceof AgentLinkValidationError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
}

export function createAgentsGetHandler(
  overrides: Partial<AgentsRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function GET(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    const requestedTeamId = readActiveTeamIdHeader(req);
    const teamId =
      requestedTeamId && (await deps.isTeamMember(requestedTeamId, userId))
        ? requestedTeamId
        : null;

    let rows: AgentRow[];
    let defaultModelId: string | null;
    try {
      [rows, defaultModelId] = await Promise.all([
        deps.listAgents({ userId, teamId }),
        // Presets follow the user's current default model rather than the
        // static template constant, scoped to the active team so the stamped
        // model matches what /api/models offers there. Display-only.
        deps.resolveDefaultModel(userId, requestedTeamId),
      ]);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Failed", 500);
    }
    const links = await deps.loadLinks(rows.map((row) => row.id));

    const forkedTemplates = new Set(
      rows
        .filter((row) => row.user_id === userId && row.source_template)
        .map((row) => row.source_template)
    );
    const presetAgents = PRECONFIGURED_AGENTS.map((t) => ({
      id: `preset:${t.name}`,
      user_id: userId,
      team_id: null,
      name: t.name,
      model: defaultModelId || t.model,
      system_prompt: t.system_prompt,
      description: t.description,
      category: t.category,
      source_template: t.name,
      created_at: new Date(0).toISOString(),
      is_preset: true,
      has_fork: forkedTemplates.has(t.name),
      shared: false,
      owned: false,
      skill_ids: [],
      rule_ids: [],
    }));

    return NextResponse.json([
      ...presetAgents,
      ...rows.map((row) => presentAgent(row, userId, links.get(row.id))),
    ]);
  };
}

export function createAgentsPostHandler(
  overrides: Partial<AgentsRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function POST(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = await req.json().catch(() => null);
    const insertData = pickAgentFields(body, AGENT_CREATE_FIELDS);
    const extras = readWriteExtras(body);
    if (extras.error) return jsonError(extras.error, 400);

    const createValidationError = validateAgentInput({
      name: insertData.name,
      description: insertData.description,
      category: insertData.category,
      systemPrompt: insertData.system_prompt,
      model: insertData.model,
      requireName: true,
      requireModel: true,
      requireCategory: true,
    });
    if (createValidationError) return jsonError(createValidationError, 400);

    const categoryError = await deps.ensureCategoryAllowed(
      userId,
      typeof insertData.category === "string" ? insertData.category : undefined
    );
    if (categoryError)
      return jsonError(categoryError.message, categoryError.status);

    if (extras.teamId && !(await deps.isTeamMember(extras.teamId, userId))) {
      return jsonError("You are not a member of that team", 403);
    }

    let row: AgentRow;
    try {
      row = await deps.insertAgent({
        ...insertData,
        user_id: userId,
        team_id: extras.teamId ?? null,
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Failed", 500);
    }
    const linkError = await applyLinks(deps, {
      agentId: row.id,
      userId,
      extras,
    });
    if (linkError) return linkError;
    const links = await deps.loadLinks([row.id]);
    return NextResponse.json(presentAgent(row, userId, links.get(row.id)));
  };
}

export function createAgentsPutHandler(
  overrides: Partial<AgentsRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function PUT(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const body = await req.json().catch(() => null);
    const rawId =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).id
        : undefined;
    if (typeof rawId !== "string" || rawId.trim().length === 0) {
      return jsonError("Invalid agent id", 400);
    }
    const id = rawId;
    const updates = pickAgentFields(body, AGENT_UPDATE_FIELDS);
    const extras = readWriteExtras(body);
    if (extras.error) return jsonError(extras.error, 400);

    const updateValidationError = validateAgentInput({
      name: updates.name,
      description: updates.description,
      category: updates.category,
      systemPrompt: updates.system_prompt,
      model: updates.model,
      requireName: updates.name !== undefined,
      requireModel: updates.model !== undefined,
      requireCategory: updates.category !== undefined,
    });
    if (updateValidationError) return jsonError(updateValidationError, 400);

    if (updates.category !== undefined) {
      const categoryError = await deps.ensureCategoryAllowed(
        userId,
        typeof updates.category === "string" ? updates.category : undefined
      );
      if (categoryError)
        return jsonError(categoryError.message, categoryError.status);
    }

    // Owners edit everything. Members of the team an agent is shared with can
    // edit its content, but only the owner decides where it is shared.
    const existing = await deps.loadAgent(id);
    const owned = existing?.user_id === userId;
    const memberOfSharedTeam =
      existing?.team_id && !owned
        ? await deps.isTeamMember(existing.team_id, userId)
        : false;
    const canEdit = Boolean(existing) && (owned || memberOfSharedTeam);
    if (!existing || !canEdit) {
      return jsonError("Agent not found", 404);
    }
    if (extras.teamId !== undefined) {
      if (!owned) return jsonError("Only the owner can change sharing", 403);
      if (extras.teamId && !(await deps.isTeamMember(extras.teamId, userId))) {
        return jsonError("You are not a member of that team", 403);
      }
    }

    let row: AgentRow;
    try {
      row = await deps.updateAgent(id, {
        ...updates,
        ...(extras.teamId === undefined ? {} : { team_id: extras.teamId }),
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Failed", 500);
    }
    const linkError = await applyLinks(deps, {
      agentId: row.id,
      userId,
      extras,
    });
    if (linkError) return linkError;
    const links = await deps.loadLinks([row.id]);
    return NextResponse.json(presentAgent(row, userId, links.get(row.id)));
  };
}

export function createAgentsDeleteHandler(
  overrides: Partial<AgentsRouteDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return async function DELETE(req: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return jsonError("Missing id", 400);
    let deleted: boolean;
    try {
      deleted = await deps.deleteAgent(id, userId);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Failed", 500);
    }
    // Only the owner can delete; a teammate or stranger sees the same 404.
    if (!deleted) return jsonError("Agent not found", 404);
    return NextResponse.json({ ok: true });
  };
}

export const GET = createAgentsGetHandler();
export const POST = createAgentsPostHandler();
export const PUT = createAgentsPutHandler();
export const DELETE = createAgentsDeleteHandler();
