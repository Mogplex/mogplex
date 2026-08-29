import type {
  ProviderMetadata,
  StreamTextTransform,
  TextStreamPart,
  ToolSet,
} from "ai";
import { redactSecretsInText, redactSecretsInValue } from "@/lib/ai-telemetry";

const PATH_SEGMENT = String.raw`[A-Za-z0-9._~@%+=,:-]+(?:[ \t]+[A-Za-z0-9._~@%+=,:-]+)*`;
const INTERNAL_UNIX_PATH_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9:/])\/(?:${PATH_SEGMENT}\/)+${PATH_SEGMENT}`,
  "g"
);
const INTERNAL_WINDOWS_PATH_PATTERN = new RegExp(
  String.raw`\b[A-Z]:\\(?:${PATH_SEGMENT}\\)+${PATH_SEGMENT}`,
  "gi"
);
const INTERNAL_IDENTIFIER_PATTERN =
  /\b(?:sbx|run|dpl|deployment|sandbox|sandbox-record|proj)[_-][a-z0-9_-]{6,}\b/gi;
const HTTP_URL_PATTERN = /https?:\/\/[^\s`'"<>()[\]{}]+/gi;
const STACK_LINE_PATTERNS = [
  /^\s*at\s+[^\n]+$/gm,
  /^\s*File\s+"[^"\n]+",\s+line\s+\d+[^\n]*$/gm,
  /^\s*from\s+\S+[^\n]*$/gm,
  /^\s*Traceback \(most recent call last\):\s*$/gm,
];
const CONFIGURATION_NAME_PATTERN =
  /\b[A-Z][A-Z0-9_]{2,}\b(?=.{0,40}\b(?:missing|required|unset|not configured)\b)/g;
const TRAILING_PATH_PUNCTUATION_PATTERN = /[.,;:!?]+$/;
const PRIVATE_IPV4_RANGES = [
  [100, 64, 127],
  [169, 254, 254],
  [172, 16, 31],
  [192, 168, 168],
] as const;

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

export type InfrastructureDiagnosticCategory =
  | "provider"
  | "filesystem-path"
  | "identifier"
  | "internal-url"
  | "stack-trace"
  | "configuration-name"
  | "runtime-topology";

export type InfrastructureDiagnosticScope =
  readonly InfrastructureDiagnosticCategory[];

const DIAGNOSTIC_CATEGORY_PATTERNS: Array<
  readonly [InfrastructureDiagnosticCategory, RegExp]
> = [
  ["provider", /\bproviders?\b/i],
  ["filesystem-path", /\b(?:absolute\s+)?(?:filesystem\s+)?paths?\b/i],
  [
    "identifier",
    /\b(?:identifiers?|(?:sandbox|deployment|run|project)\s+(?:ids?|identifiers?))\b/i,
  ],
  ["internal-url", /\b(?:internal\s+)?urls?\b/i],
  ["stack-trace", /\bstack\s+traces?\b/i],
  [
    "configuration-name",
    /\b(?:configuration|environment)\s+(?:names?|variables?)\b/i,
  ],
  [
    "runtime-topology",
    /\b(?:runtime|topology|deployment|sandbox|infrastructure)\b/i,
  ],
];

type AgentUserFacingOutputOptions = {
  diagnosticScope?: InfrastructureDiagnosticScope;
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

function replaceInternalWindowsPath(rawMatch: string) {
  const trailing = rawMatch.match(TRAILING_PATH_PUNCTUATION_PATTERN)?.[0] ?? "";
  return `the repository workspace${trailing}`;
}

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127) return true;
  return PRIVATE_IPV4_RANGES.some(
    ([network, start, end]) =>
      first === network && second >= start && second <= end
  );
}

function isInternalHostname(rawHostname: string) {
  const hostname = rawHostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isPrivateIpv4(hostname)) return true;
  if (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    /^fe[89ab]/.test(hostname)
  ) {
    return true;
  }
  if (!hostname.includes(".")) return true;
  return /\.(?:internal|local|localhost|svc|cluster|lan|corp|home|test)$/.test(
    hostname
  );
}

function replaceInternalUrls(text: string) {
  return text.replace(HTTP_URL_PATTERN, (rawMatch) => {
    const trailing =
      rawMatch.match(TRAILING_PATH_PUNCTUATION_PATTERN)?.[0] ?? "";
    const candidate = trailing ? rawMatch.slice(0, -trailing.length) : rawMatch;
    try {
      return isInternalHostname(new URL(candidate).hostname)
        ? `the internal service${trailing}`
        : rawMatch;
    } catch {
      return "the internal service";
    }
  });
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
  return resolveInfrastructureDiagnosticScope(text).length > 0;
}

/** Resolve only the infrastructure categories deliberately named by the user. */
export function resolveInfrastructureDiagnosticScope(
  text: string
): InfrastructureDiagnosticCategory[] {
  if (!EXPLICIT_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(text))) {
    return [];
  }

  return DIAGNOSTIC_CATEGORY_PATTERNS.filter(([, pattern]) =>
    pattern.test(text)
  ).map(([category]) => category);
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
  const canDisclose = (category: InfrastructureDiagnosticCategory) =>
    options.diagnosticScope?.includes(category) === true;

  if (!canDisclose("stack-trace")) {
    for (const pattern of STACK_LINE_PATTERNS) {
      sanitized = sanitized.replace(pattern, "");
    }
  }
  if (!canDisclose("internal-url")) {
    sanitized = replaceInternalUrls(sanitized);
  }
  if (!canDisclose("filesystem-path")) {
    sanitized = sanitized
      .replace(INTERNAL_UNIX_PATH_PATTERN, (match) =>
        replaceInternalPath(match, options.repoName)
      )
      .replace(INTERNAL_WINDOWS_PATH_PATTERN, replaceInternalWindowsPath);
  }
  if (!canDisclose("identifier")) {
    sanitized = sanitized.replace(
      INTERNAL_IDENTIFIER_PATTERN,
      "internal identifier"
    );
  }
  if (!canDisclose("configuration-name")) {
    sanitized = sanitized.replace(
      CONFIGURATION_NAME_PATTERN,
      "required configuration"
    );
  }
  if (!canDisclose("provider")) {
    sanitized = sanitized
      .replace(/\bVercel Sandbox\b/gi, (match) =>
        replaceUnrequestedProvider(
          match,
          "development environment",
          options.userRequestText
        )
      )
      .replace(/\bTrigger\.dev\b/gi, (match) =>
        replaceUnrequestedProvider(
          match,
          "job service",
          options.userRequestText
        )
      )
      .replace(/\b(?:Supabase|Neon|PostgREST)\b/gi, (match) =>
        replaceUnrequestedProvider(
          match,
          "data service",
          options.userRequestText
        )
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
  }

  return sanitized.replace(/\n{3,}/g, "\n\n").trim();
}

/** Raw runtime and provider errors never inherit a diagnostic disclosure scope. */
export function sanitizeAgentUserFacingError(
  text: string,
  options: Pick<AgentUserFacingOutputOptions, "repoName"> = {}
) {
  return sanitizeAgentUserFacingText(text, options);
}

function isPassThroughPayload(
  value: unknown
): value is null | number | boolean | undefined {
  const kind = typeof value;
  return (
    value === null ||
    kind === "number" ||
    kind === "boolean" ||
    kind === "undefined"
  );
}

function sanitizeAgentUserFacingPayload(
  value: unknown,
  options: Pick<AgentUserFacingOutputOptions, "repoName">,
  depth = 0
): unknown {
  if (depth >= 20) return "[redacted]";
  if (typeof value === "string") {
    return sanitizeAgentUserFacingError(value, options);
  }
  if (isPassThroughPayload(value)) return value;
  if (value instanceof Error) {
    return sanitizeAgentUserFacingError(value.message, options);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      sanitizeAgentUserFacingPayload(entry, options, depth + 1)
    );
  }
  if (typeof value === "object") {
    const redacted = redactSecretsInValue(value);
    if (!redacted || typeof redacted !== "object") return redacted;
    return Object.fromEntries(
      Object.entries(redacted).map(([key, entry]) => [
        key,
        sanitizeAgentUserFacingPayload(entry, options, depth + 1),
      ])
    );
  }
  return sanitizeAgentUserFacingError(String(value), options);
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
          if (chunk.type === "tool-error") {
            controller.enqueue({
              ...chunk,
              error: sanitizeAgentUserFacingPayload(chunk.error, options),
            } as TextStreamPart<TOOLS>);
            return;
          }
          if (chunk.type === "tool-result") {
            controller.enqueue({
              ...chunk,
              output: sanitizeAgentUserFacingPayload(chunk.output, options),
            } as TextStreamPart<TOOLS>);
            return;
          }
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
