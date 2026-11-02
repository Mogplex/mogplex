import type { RepoEnvVars } from "@/lib/repo-settings";

/**
 * Rules for the environment variables Control may save on a project: which
 * names it may use, and what a stored variable map looks like.
 */
export const ENV_NAME = /^[A-Za-z_]\w*$/;

// Names that change how every program in the sandbox starts. A value saved
// here re-arms on each boot, so only the operator may set these. The sandbox
// itself is the trust boundary (Control can run any command there); this list
// keeps an accidental or injected hook from persisting past the session.
// It is best-effort: a denylist cannot name every hook a tool reads.
const LOADER_ENV_NAMES = new Set([
  "ALL_PROXY",
  "BASH_ENV",
  "BUNDLE_GEMFILE",
  "BUNDLE_PATH",
  "CDPATH",
  "CLASSPATH",
  "CURL_CA_BUNDLE",
  "EDITOR",
  "ENV",
  "GEM_HOME",
  "GEM_PATH",
  "GIT_ASKPASS",
  "GIT_EDITOR",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "GIT_SEQUENCE_EDITOR",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GOFLAGS",
  "GRADLE_OPTS",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "IFS",
  "_JAVA_OPTIONS",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "LESSCLOSE",
  "LESSOPEN",
  "MAKEFLAGS",
  "MAVEN_OPTS",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "PAGER",
  "PATH",
  "PERL5LIB",
  "PERL5OPT",
  "PIP_CONFIG_FILE",
  "PIP_EXTRA_INDEX_URL",
  "PIP_INDEX_URL",
  "PROMPT_COMMAND",
  "PYTHONHOME",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "REQUESTS_CA_BUNDLE",
  "RUBYOPT",
  "SBT_OPTS",
  "SHELL",
  "SHELLOPTS",
  "SSH_ASKPASS",
  "SSH_AUTH_SOCK",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SUDO_ASKPASS",
  "TAR_OPTIONS",
  "VISUAL",
  "ZDOTDIR",
]);
// Names compare upper-cased, so npm_config_* and http_proxy match too.
const LOADER_ENV_PREFIXES = ["LD_", "DYLD_", "NPM_CONFIG_", "GIT_CONFIG_"];

export function isLoaderEnvName(name: string) {
  const upper = name.toUpperCase();
  return (
    LOADER_ENV_NAMES.has(upper) ||
    LOADER_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

/** The stored variable map, or an empty one if the column holds anything else. */
export function storedEnvMap(value: unknown): RepoEnvVars {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RepoEnvVars)
    : {};
}
