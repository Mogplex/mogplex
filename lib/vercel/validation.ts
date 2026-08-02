import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { VercelServiceErrorCode } from "./service";

export type PersistedVercelLinkStatus =
  | "unknown"
  | "valid"
  | "missing_project"
  | "auth_invalid"
  | "inaccessible";
export type PersistedVercelLinkErrorCode =
  | "MISSING_PROJECT"
  | "PERSONAL_VERCEL_NOT_LINKED"
  | "AUTH_INVALID"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_FORBIDDEN"
  | "TEAM_FORBIDDEN";

export type VercelLinkedProjectValidation = {
  state: "none" | "valid" | "missing_project" | "auth_invalid" | "inaccessible";
  source: "workspace" | "repo" | "account" | null;
  message: string;
  action:
    | "link_personal_vercel"
    | "select_project"
    | "reconnect_personal_vercel"
    | "review_workspace_settings"
    | null;
};

export type VercelLinkedProjectValidationSource =
  | "workspace"
  | "repo"
  | "account"
  | null;

type ProjectAccessResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: VercelServiceErrorCode;
    }
  | null;

function sourceLabel(source: VercelLinkedProjectValidationSource) {
  if (source === "workspace") return "workspace-linked";
  if (source === "account") return "account-default";
  return "repo-linked";
}

function missingProjectMessage(source: VercelLinkedProjectValidationSource) {
  if (source === "workspace") {
    return "Select or create a workspace-linked Vercel project to keep user-billed sandbox launch working.";
  }
  if (source === "account") {
    return "Select or create an account-default Vercel project to keep user-billed sandbox launch working.";
  }
  return "Select or create a repo-linked Vercel project to keep user-billed sandbox launch working.";
}

function inaccessibleMessage(source: VercelLinkedProjectValidationSource) {
  if (source === "workspace") {
    return "The workspace-linked Vercel project is missing or inaccessible. Review the workspace billing project or choose a repo-linked project here instead.";
  }

  if (source === "account") {
    return "The account-default Vercel project is missing or inaccessible. Pick a different default in Settings, or override at the workspace or repo level.";
  }

  return "The repo-linked Vercel project is missing or inaccessible. Select or create a different project to restore user-billed sandbox launch.";
}

export function deriveVercelLinkedProjectValidation(input: {
  billingMode: SandboxBillingMode;
  source: VercelLinkedProjectValidationSource;
  projectId?: string | null;
  personalState: "linked" | "not_linked";
  access: ProjectAccessResult;
}): VercelLinkedProjectValidation | null {
  if (input.billingMode !== "user_vercel_project") {
    return null;
  }

  if (!input.projectId) {
    return {
      state: "missing_project",
      source: input.source,
      message: missingProjectMessage(input.source),
      action: "select_project",
    };
  }

  if (input.personalState === "not_linked") {
    return {
      state: "auth_invalid",
      source: input.source,
      message:
        "Link Personal Vercel to keep using your own Vercel project for sandbox billing.",
      action: "link_personal_vercel",
    };
  }

  if (!input.access || input.access.ok) {
    return {
      state: "valid",
      source: input.source,
      message: `${sourceLabel(input.source)} Vercel project is reachable and ready for user-billed sandbox launch.`,
      action: null,
    };
  }

  if (input.access.code === "AUTH_INVALID") {
    return {
      state: "auth_invalid",
      source: input.source,
      message:
        "Reconnect Personal Vercel to restore access to the linked billing project.",
      action: "reconnect_personal_vercel",
    };
  }

  if (
    input.access.code !== "PROJECT_NOT_FOUND" &&
    input.access.code !== "PROJECT_FORBIDDEN" &&
    input.access.code !== "TEAM_FORBIDDEN"
  ) {
    return null;
  }

  return {
    state: "inaccessible",
    source: input.source,
    message: inaccessibleMessage(input.source),
    action:
      input.source === "workspace"
        ? "review_workspace_settings"
        : "select_project",
  };
}

export function derivePersistedVercelLinkedProjectValidation(input: {
  status?: PersistedVercelLinkStatus | null;
  source: VercelLinkedProjectValidationSource;
  message?: string | null;
  errorCode?: string | null;
}): VercelLinkedProjectValidation | null {
  const status = input.status ?? "unknown";
  if (status === "unknown") {
    return null;
  }

  if (status === "valid") {
    return {
      state: "valid",
      source: input.source,
      message:
        input.message ||
        `${sourceLabel(input.source)} Vercel project is reachable and ready for user-billed sandbox launch.`,
      action: null,
    };
  }

  if (status === "missing_project") {
    return {
      state: "missing_project",
      source: input.source,
      message: input.message || missingProjectMessage(input.source),
      action: "select_project",
    };
  }

  if (status === "auth_invalid") {
    const action =
      input.errorCode === "PERSONAL_VERCEL_NOT_LINKED"
        ? "link_personal_vercel"
        : "reconnect_personal_vercel";
    const message =
      input.message ||
      (action === "link_personal_vercel"
        ? "Link Personal Vercel to keep using your own Vercel project for sandbox billing."
        : "Reconnect Personal Vercel to restore access to the linked billing project.");

    return {
      state: "auth_invalid",
      source: input.source,
      message,
      action,
    };
  }

  return {
    state: "inaccessible",
    source: input.source,
    message: input.message || inaccessibleMessage(input.source),
    action:
      input.source === "workspace"
        ? "review_workspace_settings"
        : "select_project",
  };
}
