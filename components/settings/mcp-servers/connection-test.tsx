"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { diagnosticMessages, diagnosticResultSchema, type McpDiagnosticResult } from "@/lib/mcp-servers/diagnostic-result";
import type { McpServer } from "./types";

export function ConnectionTest({ server, onResult }: {
  server: McpServer;
  onResult: (result: McpDiagnosticResult) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<McpDiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function testConnection() {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch(`/api/mcp-servers/${server.id}/test`, { method: "POST" });
      if (!response.ok) {
        setError(response.status === 401 ? "Sign in again to test this connection." : response.status === 404 ? "This server no longer exists. Refresh the page." : "The test could not complete. Try again.");
        return;
      }
      const data = diagnosticResultSchema.parse(await response.json());
      if (data.serverUpdatedAt && data.serverUpdatedAt !== server.updatedAt) {
        setError("The saved settings changed. Refresh the page, then test again.");
        return;
      }
      setResult(data);
      onResult(data);
    } catch {
      setError("The test could not complete. Check your connection and try again.");
    } finally {
      setTesting(false);
    }
  }
  if (server.transport === "stdio") return null;
  const success = result?.status === "success" ? result : null;
  const available = success?.tools.filter((tool) => tool.approval !== "deny") ?? [];
  const automatic = available.filter((tool) => tool.approval !== "prompt").length;
  const prompts = available.length - automatic;
  return <div className="space-y-2 border-t border-border pt-3">
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" variant="outline" disabled={testing} onClick={() => void testConnection()}>{testing ? "Testing connection..." : "Test connection"}</Button>
      <p className="text-xs text-muted-foreground">Lists tools without running them.</p>
    </div>
    <div role="status" aria-live="polite" className="space-y-1 text-sm">
      {!result && !error && !testing && <p className="text-muted-foreground">Not tested in this visit.</p>}
      {error && <p className="text-destructive">{error}</p>}
      {result?.status === "error" && <p className="text-destructive">{diagnosticMessages[result.code]}</p>}
      {success && <>
        <p>Connection test passed. {success.tools.length} {success.tools.length === 1 ? "tool" : "tools"} found.</p>
        {success.enabled ? <p className="text-muted-foreground">{automatic} available in workspace chat. Control approval required: {prompts}. Blocked: {success.tools.length - available.length}.</p> : <p className="text-muted-foreground">This server is disabled. Enable it to make its allowed tools available.</p>}
        {success.tools.length === 0 && <p className="text-muted-foreground">The server did not advertise any tools.</p>}
        {success.tools.length > 0 && <details>
          <summary className="cursor-pointer text-sm">Discovered tools</summary>
          <ul className="mt-2 space-y-1">{success.tools.map((tool) => <li key={tool.name} className="break-words"><span className="font-mono">{tool.name}</span>: {tool.approval === "deny" ? "Blocked" : tool.approval === "prompt" ? "Control only: approval required" : "Runs automatically"}</li>)}</ul>
        </details>}
      </>}
      {result && <p className="text-xs text-muted-foreground">Last test: {new Date(result.checkedAt).toLocaleString()}. Availability can change.</p>}
    </div>
  </div>;
}
