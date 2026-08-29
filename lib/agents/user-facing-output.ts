import type {
  ProviderMetadata,
  StreamTextTransform,
  TextStreamPart,
  ToolSet,
} from "ai";
import { redactSecretsInText } from "@/lib/ai-telemetry";

const INTERNAL_UNIX_PATH_PATTERN =
  /(?<![A-Za-z0-9])\/(?:vercel\/sandbox|private\/tmp|tmp|var\/task|home\/[A-Za-z0-9._-]+|Users\/[A-Za-z0-9._-]+|workspace)(?:\/[A-Za-z0-9._~@%+=:,/-]+)+/g;
const INTERNAL_WINDOWS_PATH_PATTERN =
  /\b[A-Z]:\\(?:Users|workspace|temp|tmp)\\[^\s`'"<>()[\]{}]+/gi;
const INTERNAL_IDENTIFIER_PATTERN =
  /\b(?:sbx|run|dpl|deployment|sandbox|sandbox-record|proj)[_-][a-z0-9_-]{6,}\b/gi;
const INTERNAL_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[^\s/]+\.(?:internal|local))(?::\d+)?(?:\/[^\s`'"<>]*)?/gi;
const STACK_LINE_PATTERN = /^\s*at\s+[^\n]+$/gm;
const CONFIGURATION_NAME_PATTERN =
  /\b[A-Z][A-Z0-9_]{2,}\b(?=.{0,40}\b(?:missing|required|unset|not configured)\b)/g;
const TRAILING_PATH_PUNCTUATION_PATTERN = /[.,;:!?]+$/;

const DIAGNOSTIC_ACTION =
  "(?:show|include|reveal|display|print|inspect|explain|debug|diagnos(?:e|tic|tics)|trace)";
const INFRASTRUCTURE_SUBJECT =
  "(?:raw|internal|infrastructure|provider|runtime|deployment|sandbox|filesystem|absolute path|identifier|stack trace)";
const EXPLICIT_DIAGNOSTIC_PATTERNS = [
  new RegExp(
    `\\b${DIAGNOSTIC_ACTION}\\b.{0,100}\\b${INFRASTRUCTURE_SUBJECT}\\b`,
    "i"
  ),
  new RegExp(
    `\\b${INFRASTRUCTURE_SUBJECT}\\b.{0,100}\\b(?:details|diagnostics?|metadata|topology|paths?|identifiers?)\\b`,
    "i"
  ),
];

type AgentUserFacingOutputOptions = {
  allowInfrastructureDiagnostics?: boolean;
  repoName?: string | null;
  userRequestText?: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repositoryRelativePath(
  absolutePath: string,
  repoName?: string | null
) {
  const worktreeMatch = absolutePath.match(/\/\.worktrees\/[^/]+\/(.+)$/);
  if (worktreeMatch?.[1]) return worktreeMatch[1];

  if (repoName) {
    const repoMatch = absolutePath.match(
      new RegExp(`/${escapeRegExp(repoName)}/(.+)$`, "i")
    );
    if (repoMatch?.[1]) return repoMatch[1];
  }

  const sandboxMatch = absolutePath.match(/^\/vercel\/sandbox\/(.+)$/);
  if (sandboxMatch?.[1]) return sandboxMatch[1];

  const workspaceMatch = absolutePath.match(/^\/workspace\/(.+)$/);
  if (workspaceMatch?.[1]) return workspaceMatch[1];

  return null;
}

function replaceInternalPath(rawMatch: string, repoName?: string | null) {
  const trailing = rawMatch.match(TRAILING_PATH_PUNCTUATION_PATTERN)?.[0] ?? "";
  const path = trailing ? rawMatch.slice(0, -trailing.length) : rawMatch;
  const relative = repositoryRelativePath(path, repoName);
  return `${relative ? `\`${relative}\`` : "the repository workspace"}${trailing}`;
}

function replaceUnrequestedProvider(
  providerName: string,
  productName: string,
  userRequestText = ""
) {
  return new RegExp(`\\b${escapeRegExp(providerName)}\\b`, "i").test(
    userRequestText
  )
    ? providerName
    : productName;
}

/**
 * Explicit diagnostic disclosure is allowed only inside the authenticated,
 * resource-scoped Control route and only when the latest user request clearly
 * asks for infrastructure diagnostics. Ordinary provider/product work does not
 * opt into raw operational details.
 */
export function isExplicitInfrastructureDiagnosticRequest(text: string) {
  return EXPLICIT_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Present assistant prose at the product boundary. Tool telemetry can retain
 * the raw values for authorized operators; normal user-facing text cannot.
 */
export function sanitizeAgentUserFacingText(
  text: string,
  options: AgentUserFacingOutputOptions = {}
) {
  let sanitized = redactSecretsInText(text);
  if (options.allowInfrastructureDiagnostics) return sanitized;

  sanitized = sanitized
    .replace(STACK_LINE_PATTERN, "")
    .replace(INTERNAL_URL_PATTERN, "the internal service")
    .replace(INTERNAL_UNIX_PATH_PATTERN, (match) =>
      replaceInternalPath(match, options.repoName)
    )
    .replace(INTERNAL_WINDOWS_PATH_PATTERN, "the repository workspace")
    .replace(INTERNAL_IDENTIFIER_PATTERN, "internal identifier")
    .replace(CONFIGURATION_NAME_PATTERN, "required configuration")
    .replace(/\bVercel Sandbox\b/gi, (match) =>
      replaceUnrequestedProvider(
        match,
        "development environment",
        options.userRequestText
      )
    )
    .replace(/\bTrigger\.dev\b/gi, (match) =>
      replaceUnrequestedProvider(match, "job service", options.userRequestText)
    )
    .replace(/\b(?:Supabase|Neon|PostgREST)\b/gi, (match) =>
      replaceUnrequestedProvider(match, "data service", options.userRequestText)
    )
    .replace(/\b(?:AWS Lambda|Google Cloud Run|Cloud Run)\b/gi, (match) =>
      replaceUnrequestedProvider(
        match,
        "compute service",
        options.userRequestText
      )
    )
    .replace(
      /\bVercel\b(?=.{0,30}\b(?:deployment|runtime|sandbox|provider|region|project)\b)/gi,
      (match) =>
        replaceUnrequestedProvider(
          match,
          "hosting service",
          options.userRequestText
        )
    );

  return sanitized.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Buffer each contiguous text/reasoning segment before sanitizing it. Provider
 * deltas can split a path or identifier anywhere, so per-delta replacement is
 * not a reliable user-facing boundary.
 */
export function createAgentUserFacingOutputTransform<TOOLS extends ToolSet>(
  options: AgentUserFacingOutputOptions = {}
): StreamTextTransform<TOOLS> {
  return () => {
    let buffer = "";
    let id = "";
    let type: "text-delta" | "reasoning-delta" | null = null;
    let providerMetadata: ProviderMetadata | undefined;

    const flush = (
      controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>
    ) => {
      if (!type || !buffer) return;
      const text = sanitizeAgentUserFacingText(buffer, options);
      if (text) {
        controller.enqueue({
          type,
          id,
          text,
          ...(providerMetadata ? { providerMetadata } : {}),
        } as TextStreamPart<TOOLS>);
      }
      buffer = "";
      id = "";
      type = null;
      providerMetadata = undefined;
    };

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") {
          flush(controller);
          controller.enqueue(chunk);
          return;
        }

        if (type && (type !== chunk.type || id !== chunk.id)) {
          flush(controller);
        }
        type = chunk.type;
        id = chunk.id;
        buffer += chunk.text;
        if (chunk.providerMetadata) {
          providerMetadata = chunk.providerMetadata;
        }
      },
      flush,
    });
  };
}
