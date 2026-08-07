import type {
  VercelDeploymentSummary,
  VercelProjectEnvVar,
  RawVercelDeployment,
  UpsertEnvVarInput,
  EnvVarUpsertRequest,
} from "./service-types";
import { appendTeamId } from "./service-errors";

export function readOptionalString(value?: string | null) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readStringOrFallback(
  value: string | null | undefined,
  fallback: string
) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function buildDeploymentSummary(
  deployment: RawVercelDeployment,
  fallbackName: string,
  fallbackId: string
): VercelDeploymentSummary {
  return {
    id: readStringOrFallback(deployment.id, fallbackId),
    projectId: readOptionalString(deployment.projectId),
    name: readStringOrFallback(deployment.name, fallbackName),
    url: readOptionalString(deployment.url),
    readyState: readOptionalString(deployment.readyState),
    readySubstate: readOptionalString(deployment.readySubstate),
    readyStateReason: readOptionalString(deployment.readyStateReason),
    errorCode: readOptionalString(deployment.errorCode),
    errorMessage: readOptionalString(deployment.errorMessage),
    createdAt: deployment.createdAt ?? null,
    target: readOptionalString(deployment.target),
    inspectorUrl: readOptionalString(deployment.inspectorUrl),
  };
}

function buildEnvVarCreateBody(input: UpsertEnvVarInput) {
  return {
    key: input.key?.trim(),
    value: input.value ?? "",
    target: input.target || ["production", "preview", "development"],
    type: input.type || "encrypted",
  };
}

function buildEnvVarUpdateBody(input: UpsertEnvVarInput) {
  return {
    value: input.value ?? "",
    target: input.target,
  };
}

export function buildEnvVarUpsertRequest(
  input: UpsertEnvVarInput,
  teamId: string | null
): EnvVarUpsertRequest {
  if (input.envId) {
    return {
      isUpdate: true,
      method: "PATCH",
      url: appendTeamId(
        `https://api.vercel.com/v10/projects/${input.projectId}/env/${input.envId}`,
        teamId
      ),
      body: JSON.stringify(buildEnvVarUpdateBody(input)),
    };
  }

  return {
    isUpdate: false,
    method: "POST",
    url: appendTeamId(
      `https://api.vercel.com/v10/projects/${input.projectId}/env`,
      teamId
    ),
    body: JSON.stringify(buildEnvVarCreateBody(input)),
  };
}

export function buildUpdatedEnvVarResult(
  input: UpsertEnvVarInput
): VercelProjectEnvVar {
  return {
    id: input.envId,
    key: input.key || "",
    value: input.value ?? "",
    target: input.target,
    type: input.type as VercelProjectEnvVar["type"],
  };
}
