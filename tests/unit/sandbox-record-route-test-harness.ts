export { loadSandboxRecordRouteModule } from "./sandbox-record-route-test-harness/loaders";
export {
  buildLoadedSandboxHealthRouteContext,
  buildLoadedValidatedTerminalProxyRequest,
  buildResolvedSandboxRouteContext,
  buildSandboxRouteContextFailure,
} from "./sandbox-record-route-test-harness/context-builders";
export {
  buildSandboxRouteParams,
  buildSandboxRouteRequest,
  buildSandboxTerminalSessionRouteParams,
} from "./sandbox-record-route-test-harness/request-builders";

export async function readStreamBody(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body;
}
