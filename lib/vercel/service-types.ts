export type VercelAuthMode = "platform" | "personal";

export type VercelServiceErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_INVALID"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_FORBIDDEN"
  | "TEAM_FORBIDDEN"
  | "RATE_LIMITED"
  | "API_ERROR";

export type VercelServiceError = {
  code: VercelServiceErrorCode;
  message: string;
  status: number;
};

export type VercelServiceResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: VercelServiceError;
    };

export type VercelServiceAccess = {
  authMode: VercelAuthMode;
  vercelToken?: string | null;
  teamId?: string | null;
};

export type VercelTeamSummary = {
  id: string;
  name: string;
};

export type VercelProjectSummary = {
  id: string;
  name: string;
  framework?: string | null;
};

export type VercelDeploymentSummary = {
  id: string;
  projectId: string | null;
  name: string;
  url: string | null;
  readyState: string | null;
  readySubstate: string | null;
  readyStateReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number | null;
  target: string | null;
  inspectorUrl: string | null;
};

export type VercelDeploymentLogEvent = {
  type: string | null;
  created: number | null;
  text: string | null;
  statusCode: number | null;
  readyState: string | null;
};

export type VercelProjectEnvVar = {
  id?: string;
  key: string;
  value?: string;
  target?: string[];
  type?: "encrypted" | "plain" | "secret" | "system";
  configurationId?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

export type VercelFetch = typeof fetch;

export type ResponseContext = {
  operation:
    | "teams"
    | "projects"
    | "project_validate"
    | "project_read"
    | "project_create"
    | "deployment_list"
    | "deployment_read"
    | "deployment_events"
    | "env_list"
    | "env_upsert"
    | "env_delete";
  teamScoped: boolean;
};

export type RawVercelDeployment = {
  id?: string;
  projectId?: string | null;
  name?: string;
  url?: string | null;
  readyState?: string | null;
  readySubstate?: string | null;
  readyStateReason?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: number | null;
  target?: string | null;
  inspectorUrl?: string | null;
};

export type UpsertEnvVarInput = VercelServiceAccess & {
  projectId: string;
  envId?: string;
  key?: string;
  value?: string;
  target?: string[];
  type?: string;
};

export type EnvVarUpsertRequest = {
  isUpdate: boolean;
  method: "PATCH" | "POST";
  url: string;
  body: string;
};
