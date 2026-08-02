export function buildSandboxRouteRequest({
  id = "sandbox-1",
  method = "GET",
  suffix = "",
  init,
}: {
  id?: string;
  method?: "GET" | "DELETE" | "POST";
  suffix?: string;
  init?: RequestInit;
} = {}) {
  return new Request(`http://localhost/api/sandbox/${id}${suffix}`, {
    ...init,
    method: init?.method ?? method,
  });
}

export function buildSandboxRouteParams(id = "sandbox-1") {
  return {
    params: Promise.resolve({ id }),
  };
}

export function buildSandboxTerminalSessionRouteParams({
  id = "sandbox-record-1",
  sessionId = "session-1",
}: {
  id?: string;
  sessionId?: string;
} = {}) {
  return {
    params: Promise.resolve({ id, sessionId }),
  };
}
