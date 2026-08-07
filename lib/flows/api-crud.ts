import { FlowServiceError } from "@/lib/flows/errors";
import { validateFlowGraph } from "@/lib/flows/graph";
import {
  assertOwnedFlowGraphAgents,
  buildDefaultFlowDraft as buildDefaultFlowDraftProd,
  createFlowTemplate as createFlowTemplateProd,
  createPersonalFlowTemplate as createPersonalFlowTemplateProd,
  deleteFlowTemplate as deleteFlowTemplateProd,
  deleteFlow as deleteFlowProd,
  duplicateFlow as duplicateFlowProd,
  listFlowTemplates as listFlowTemplatesProd,
  listOwnedPersonalFlowTemplates as listOwnedPersonalFlowTemplatesProd,
  loadFlowTemplate as loadFlowTemplateProd,
  loadOwnedFlow as loadOwnedFlowProd,
  loadOwnedPersonalFlowTemplate as loadOwnedPersonalFlowTemplateProd,
  publishFlowDraft as publishFlowDraftProd,
  // resolveFlowGraphPresetAgents is intentionally imported directly from
  // server.ts and is NOT wrapped in an isFlowsE2ETestMode() branch. Preset
  // resolution must always hit real Supabase so that agent rows are created
  // (or looked up) under the real user ID. The E2E test store handles
  // updateFlow / publishFlowDraft separately and never surfaces preset: IDs.
  resolveFlowGraphPresetAgents,
  syncFlowActivation as syncFlowActivationProd,
} from "@/lib/flows/server";
import {
  createFlowForUser as createFlowForUserTest,
  createFlowTemplate as createFlowTemplateTest,
  createPersonalFlowTemplate as createPersonalFlowTemplateTest,
  deleteFlowTemplate as deleteFlowTemplateTest,
  deleteFlow as deleteFlowTest,
  duplicateFlow as duplicateFlowTest,
  isFlowsE2ETestMode,
  listFlowTemplates as listFlowTemplatesTest,
  listOwnedPersonalFlowTemplates as listOwnedPersonalFlowTemplatesTest,
  loadOwnedFlow as loadOwnedFlowTest,
  loadOwnedInstallation as loadOwnedInstallationTest,
  publishFlowDraft as publishFlowDraftTest,
  syncFlowActivation as syncFlowActivationTest,
  updateFlow as updateFlowTest,
} from "@/lib/flows/test-store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FlowGraph } from "@/lib/types";
import type { FlowStarterTemplateId } from "@/lib/flows/templates";
import type { ProductResourceScope } from "@/lib/team-resource-scope";
import {
  bindFlowGraphToScope,
  flowTemplateRequiresRepository,
  preparePersonalFlowTemplateGraphForValidation,
} from "@/lib/flows/templates";
import { unwrapOrThrow } from "@/lib/flows/supabase-result";

async function loadOwnedInstallationProd(
  userId: string,
  installationId: number
) {
  const { data } = await supabaseAdmin
    .from("github_installations")
    .select("id")
    .eq("user_id", userId)
    .eq("installation_id", installationId)
    .maybeSingle();

  return data;
}

export async function loadOwnedInstallation(
  userId: string,
  installationId: number
) {
  if (isFlowsE2ETestMode()) {
    return loadOwnedInstallationTest(userId, installationId);
  }

  return loadOwnedInstallationProd(userId, installationId);
}

export async function createFlowForUser(input: {
  userId: string;
  installationId: number;
  name?: string | null;
  templateId?: FlowStarterTemplateId | null;
  personalTemplateId?: string | null;
  teamTemplateId?: string | null;
  teamId?: string | null;
  repository?: string | null;
}) {
  if (isFlowsE2ETestMode()) {
    return createFlowForUserTest(input);
  }

  const installation = await loadOwnedInstallationProd(
    input.userId,
    input.installationId
  );
  if (!installation) {
    throw new FlowServiceError(
      "FLOW_INSTALLATION_NOT_FOUND",
      "Installation not found"
    );
  }

  const repository = input.repository?.trim() || null;
  if (repository) {
    const { data: ownedRepo, error: ownedRepoError } = await supabaseAdmin
      .from("repos")
      .select("id")
      .eq("user_id", input.userId)
      .eq("full_name", repository)
      .eq("github_installation_id", input.installationId)
      .maybeSingle();
    if (ownedRepoError) {
      throw new FlowServiceError(
        "FLOW_STORAGE_FAILED",
        `Failed to validate workflow repository: ${ownedRepoError.message}`,
        { cause: ownedRepoError }
      );
    }
    if (!ownedRepo) {
      throw new FlowServiceError(
        "FLOW_INSTALLATION_NOT_FOUND",
        "Repository not found for this GitHub account"
      );
    }
  }

  const personalTemplate = input.personalTemplateId
    ? await loadOwnedPersonalFlowTemplateProd(
        input.userId,
        input.personalTemplateId
      )
    : null;
  const teamTemplate =
    input.teamTemplateId && input.teamId
      ? await loadFlowTemplateProd(
          {
            kind: "team",
            userId: input.userId,
            productTeamId: input.teamId,
          },
          input.teamTemplateId
        )
      : null;
  if (input.personalTemplateId && !personalTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  if (input.teamTemplateId && !teamTemplate) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Workflow template not found");
  }
  const storedTemplate = personalTemplate ?? teamTemplate;
  if (
    storedTemplate &&
    flowTemplateRequiresRepository(storedTemplate.graph) &&
    !repository
  ) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      "This workflow template requires a repository."
    );
  }

  const baseDraft = storedTemplate
    ? {
        name: input.name?.trim() || storedTemplate.name,
        description: storedTemplate.description,
        draftGraph: storedTemplate.graph,
      }
    : await buildDefaultFlowDraftProd(input);
  const draft = {
    ...baseDraft,
    draftGraph: bindFlowGraphToScope(baseDraft.draftGraph, {
      installationId: input.installationId,
      repository,
    }),
  };
  const validation = validateFlowGraph(
    storedTemplate
      ? preparePersonalFlowTemplateGraphForValidation(draft.draftGraph)
      : draft.draftGraph,
    { requireRunnableConfig: Boolean(personalTemplate) }
  );
  if (!validation.valid) {
    throw new FlowServiceError(
      "FLOW_GRAPH_INVALID",
      validation.errors[0] || "Workflow template is invalid",
      { details: validation.errors }
    );
  }
  await assertOwnedFlowGraphAgents(input.userId, draft.draftGraph);

  const { data, error } = await supabaseAdmin
    .from("flows")
    .insert({
      user_id: input.userId,
      installation_id: input.installationId,
      name: draft.name,
      description: draft.description,
      source_kind: "github",
      status: "inactive",
      draft_graph: draft.draftGraph,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return loadOwnedFlowProd(input.userId, data.id);
}

export async function listOwnedPersonalFlowTemplates(
  userId: string,
  cursor = 0
) {
  if (isFlowsE2ETestMode()) {
    return listOwnedPersonalFlowTemplatesTest(userId, cursor);
  }
  return listOwnedPersonalFlowTemplatesProd(userId, cursor);
}

export async function listFlowTemplates(
  scope: ProductResourceScope,
  cursor = 0
) {
  if (isFlowsE2ETestMode()) {
    return listFlowTemplatesTest(scope, cursor);
  }
  return listFlowTemplatesProd(scope, cursor);
}

export async function createFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
  scope: ProductResourceScope;
}) {
  if (isFlowsE2ETestMode()) {
    return createFlowTemplateTest(input);
  }
  return createFlowTemplateProd(input);
}

export async function createPersonalFlowTemplate(input: {
  userId: string;
  flowId: string;
  name?: string | null;
}) {
  if (isFlowsE2ETestMode()) {
    return createPersonalFlowTemplateTest(input);
  }
  return createPersonalFlowTemplateProd(input);
}

export async function deleteFlowTemplate(
  scope: ProductResourceScope,
  templateId: string
) {
  if (isFlowsE2ETestMode()) {
    return deleteFlowTemplateTest(scope, templateId);
  }
  return deleteFlowTemplateProd(scope, templateId);
}

export async function loadOwnedFlow(userId: string, flowId: string) {
  if (isFlowsE2ETestMode()) {
    return loadOwnedFlowTest(userId, flowId);
  }

  return loadOwnedFlowProd(userId, flowId);
}

/** Validate an installation id and confirm the caller owns it, if supplied. */
async function assertOwnedInstallation(
  userId: string,
  installationId: number | undefined
) {
  if (installationId === undefined) return;

  if (!Number.isFinite(installationId) || installationId <= 0) {
    throw new FlowServiceError(
      "FLOW_INVALID_INSTALLATION_ID",
      "Invalid installation_id"
    );
  }

  const installation = await loadOwnedInstallationProd(userId, installationId);
  if (!installation) {
    throw new FlowServiceError(
      "FLOW_INSTALLATION_NOT_FOUND",
      "Installation not found"
    );
  }
}

/** Only fields the caller actually supplied are patched. */
function buildFlowUpdatePatch(input: {
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
}): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof input.name === "string" && input.name.trim()) {
    updates.name = input.name.trim();
  }
  if (input.description !== undefined) updates.description = input.description;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (typeof input.installationId === "number") {
    updates.installation_id = input.installationId;
  }

  return updates;
}

export async function updateFlow(input: {
  userId: string;
  flowId: string;
  name?: string;
  description?: string | null;
  notes?: string | null;
  installationId?: number;
  draftGraph?: FlowGraph;
  // Verified active-team scope from the request header (null/omitted =
  // personal). Threaded into preset fork resolution so the immutable fork is
  // stamped with the same scope the UI displayed the preset model under.
  teamId?: string | null;
}) {
  if (isFlowsE2ETestMode()) {
    return updateFlowTest(input);
  }

  const flow = await loadOwnedFlowProd(input.userId, input.flowId);
  if (!flow) {
    throw new FlowServiceError("FLOW_NOT_FOUND", "Flow not found");
  }

  await assertOwnedInstallation(input.userId, input.installationId);

  const updates = buildFlowUpdatePatch(input);

  // Resolve preset agent IDs (e.g. "preset:NEXTJS-REVIEWER") into real
  // user-owned agent rows before ownership verification and persistence.
  // resolvedGraph is always a complete FlowGraph when input.draftGraph is
  // provided — resolveFlowGraphPresetAgents throws rather than returning null
  // on failure, so the update is aborted cleanly if resolution fails.
  if (input.draftGraph) {
    const resolvedGraph = await resolveFlowGraphPresetAgents(
      input.userId,
      input.draftGraph,
      undefined,
      input.teamId ?? null
    );
    await assertOwnedFlowGraphAgents(input.userId, resolvedGraph);
    updates.draft_graph = resolvedGraph;
  }

  const data = unwrapOrThrow(
    await supabaseAdmin
      .from("flows")
      .update(updates)
      .eq("id", input.flowId)
      .eq("user_id", input.userId)
      .select("*")
      .single()
  );

  return loadOwnedFlowProd(input.userId, data.id);
}

export async function syncFlowActivation(
  userId: string,
  flowId: string,
  status: "active" | "inactive"
) {
  if (isFlowsE2ETestMode()) {
    return syncFlowActivationTest(userId, flowId, status);
  }

  return syncFlowActivationProd(userId, flowId, status);
}

export async function publishFlowDraft(
  userId: string,
  flowId: string,
  teamId: string | null = null
) {
  if (isFlowsE2ETestMode()) {
    return publishFlowDraftTest(userId, flowId);
  }

  return publishFlowDraftProd(userId, flowId, teamId);
}

export async function duplicateFlow(
  userId: string,
  flowId: string,
  teamId: string | null = null
) {
  if (isFlowsE2ETestMode()) {
    return duplicateFlowTest(userId, flowId);
  }

  return duplicateFlowProd(userId, flowId, teamId);
}

export async function deleteFlow(userId: string, flowId: string) {
  if (isFlowsE2ETestMode()) {
    return deleteFlowTest(userId, flowId);
  }

  return deleteFlowProd(userId, flowId);
}
