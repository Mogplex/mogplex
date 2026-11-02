/**
 * Which environment variable names Control may save on a project, for the
 * project_env_set tool.
 */
export const ENV_NAME = /^[A-Za-z_]\w*$/;

// Names that change how every program in the sandbox starts. A value saved
// here re-arms on each boot, so only the operator may set these. The sandbox
// itself is the trust boundary (Control can run any command there); this list
// keeps an accidental or injected hook from persisting past the session.
const LOADER_ENV_NAMES = new Set([
  "ALL_PROXY",
  "BASH_ENV",
  "CDPATH",
  "CURL_CA_BUNDLE",
  "EDITOR",
  "ENV",
  "GIT_ASKPASS",
  "GIT_EDITOR",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GOFLAGS",
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
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "PAGER",
  "PATH",
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
  "SHELL",
  "SSH_ASKPASS",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TAR_OPTIONS",
  "VISUAL",
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
