import { Sandbox } from "@vercel/sandbox";
import { detectMissingEnvVarHint } from "./env-var-hint";

export type SandboxHealthStatus =
  | "running"
  | "starting"
  | "pausing"
  | "stopped"
  | "paused"
  | "error"
  | "app_error"
  | "unreachable"
  | "not_available"
  | "idle_warning";

type HealthCheckResult = {
  status: SandboxHealthStatus;
  message: string;
  statusCode?: number;
};

type HealthCheckOptions = {
  treatRoot404AsReady?: boolean;
};

function detectAppErrorHint(body: string): string {
  const hint = detectMissingEnvVarHint(body);
  if (hint) {
    return `App failed to start — ${hint}. Check your sandbox environment variables in repo settings.`;
  }
  return "Dev server is responding with an application error";
}

/**
 * Rich health check that verifies sandbox existence + HTTP preview status.
 * Maps HTTP responses to granular health states matching coding-agent-template.
 */
export async function checkSandboxHealth(
  sandboxUrl: string | null,
  sandboxCredentials?: {
    sandboxId: string;
    token: string;
    projectId: string;
    teamId?: string | null;
  },
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  if (!sandboxUrl) {
    return { status: "not_available", message: "No preview URL" };
  }

  // Verify sandbox still exists and is running. Pass resume:false so the
  // health probe never accidentally wakes a paused persistent sandbox.
  if (sandboxCredentials) {
    try {
      const vm = await Sandbox.get({
        name: sandboxCredentials.sandboxId,
        resume: false,
        token: sandboxCredentials.token,
        projectId: sandboxCredentials.projectId,
        ...(sandboxCredentials.teamId
          ? { teamId: sandboxCredentials.teamId }
          : {}),
      });
      if (vm.status !== "running" && vm.status !== "pending") {
        return { status: "stopped", message: `Sandbox is ${vm.status}` };
      }
    } catch (error) {
      console.warn(
        `[sandbox/health] Failed to verify sandbox ${sandboxCredentials.sandboxId} with Vercel; continuing with preview probe`,
        error
      );
    }
  }

  // HTTP health probe
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(sandboxUrl, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const body = await response.text();

    // 200 with empty body → dev server booting (returns sandbox shell page)
    if (response.status === 200 && body.length === 0) {
      return { status: "starting", message: "Dev server is starting up" };
    }

    if (response.ok && body.length > 0) {
      return {
        status: "running",
        message: "Sandbox and dev server are running",
      };
    }

    if (response.status === 410) {
      return {
        status: "stopped",
        message: "Sandbox has stopped or expired",
        statusCode: response.status,
      };
    }

    if (response.status === 404 && options.treatRoot404AsReady) {
      return {
        status: "app_error",
        message: "Preview is reachable but the root path returned 404",
        statusCode: response.status,
      };
    }

    if (
      response.status === 502 ||
      response.status === 404 ||
      response.status === 503
    ) {
      return {
        status: "starting",
        message: "Dev server is starting up",
        statusCode: response.status,
      };
    }

    if (response.status >= 500) {
      return {
        status: "app_error",
        message: detectAppErrorHint(body),
        statusCode: response.status,
      };
    }

    // Redirects and other 2xx/3xx/4xx → treat as running
    return {
      status: "running",
      message: "Preview is accessible",
      statusCode: response.status,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "unreachable", message: "Preview request timed out" };
    }
    return {
      status: "unreachable",
      message: "Network error — cannot reach preview",
    };
  }
}

export { detectMissingEnvVarHint } from "./env-var-hint";
