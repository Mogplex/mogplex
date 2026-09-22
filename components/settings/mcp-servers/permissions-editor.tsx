"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { readToolPolicy, toolApproval, updateToolPolicy, normalizeToolNames, type ToolApproval } from "@/lib/mcp-servers/policy";
import { parseExtra } from "./helpers";

export function PermissionsEditor({ extraText, onChange, toolNames = [] }: {
  extraText: string;
  onChange: (value: string) => void;
  toolNames?: string[];
}) {
  const [newTool, setNewTool] = useState("");
  let extra: Record<string, unknown>;
  let policy: ReturnType<typeof readToolPolicy>;
  try {
    extra = parseExtra(extraText);
    policy = readToolPolicy(extra);
  } catch {
    return <p role="alert" className="text-sm text-destructive">Tool permissions are invalid. Correct the permission fields in Extra JSON before saving.</p>;
  }
  const write = (value: Record<string, unknown>) => onChange(JSON.stringify(value, null, 2));
  const names = [...new Set([...toolNames, ...Object.keys(policy.tools ?? {}), ...(policy.enabled_tools ?? []), ...(policy.disabled_tools ?? [])])].filter(Boolean).sort();
  const setMode = (mode: ToolApproval | "inherit", tool?: string) => write(updateToolPolicy(extra, { mode, tool }));
  const lines = (value: string) => value ? value.split("\n") : [];

  return <section aria-label="Tool permissions" className="space-y-4 border-t border-border pt-4">
    <div>
      <h3 className="text-sm font-medium">Tool permissions</h3>
      <p className="text-sm text-muted-foreground">Choose which tools agents can use. Changes apply on the next turn.</p>
    </div>
    <div className="space-y-2">
      <Label htmlFor="mcp-default-approval">Default approval</Label>
      <Select value={policy.default_tools_approval_mode === "approve" ? "auto" : policy.default_tools_approval_mode ?? "auto"} onValueChange={(value) => setMode(value as ToolApproval)}>
        <SelectTrigger id="mcp-default-approval"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Run automatically</SelectItem>
          <SelectItem value="prompt">Ask in Control</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">Tools that need approval are available in Control only, not workspace chat. The CLI also receives these permissions.</p>
    </div>
    <div className="flex items-center gap-3">
      <Switch id="mcp-all-tools" checked={policy.enabled_tools === undefined} onCheckedChange={(checked) => {
        const next = { ...extra };
        if (checked) delete next.enabled_tools;
        else next.enabled_tools = [];
        write(next);
      }} />
      <Label htmlFor="mcp-all-tools">Allow all tools unless blocked</Label>
    </div>
    {policy.enabled_tools !== undefined && <div className="space-y-2">
      <Label htmlFor="mcp-allowed-tools">Allowed tools (one name per line)</Label>
      <Textarea id="mcp-allowed-tools" value={policy.enabled_tools.join("\n")} onChange={(event) => write({ ...extra, enabled_tools: lines(event.target.value) })} onBlur={(event) => write({ ...extra, enabled_tools: normalizeToolNames(lines(event.target.value)) })} />
      <p className="text-sm text-muted-foreground">An empty list allows no tools. New tools stay unavailable until added here.</p>
    </div>}
    <div className="space-y-2">
      <Label htmlFor="mcp-blocked-tools">Blocked tools (one name per line)</Label>
      <Textarea id="mcp-blocked-tools" value={(policy.disabled_tools ?? []).join("\n")} onChange={(event) => write({ ...extra, disabled_tools: lines(event.target.value) })} onBlur={(event) => write({ ...extra, disabled_tools: normalizeToolNames(lines(event.target.value)) })} />
      <p className="text-sm text-muted-foreground">Blocked tools remain unavailable even if their approval allows them.</p>
    </div>
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Per-tool approval</h4>
      {names.map((name) => {
        const entry = policy.tools?.[name];
        const mode = entry?.approval_mode === "approve" ? "auto" : entry?.approval_mode ?? "inherit";
        const effective = toolApproval(policy, name);
        return <div key={name} className="grid gap-2 border-b border-border pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <p className="break-all font-mono text-sm">{name}</p>
            <p className="text-xs text-muted-foreground">{effective === "deny" ? "Blocked" : effective === "prompt" ? "Control only: approval required" : "Workspace chat and Control"}</p>
            {entry?.enabled === false && <div className="mt-2 flex items-center gap-2">
              <Switch aria-label={`Enable ${name}`} checked={false} onCheckedChange={() => {
                const tools = (extra.tools ?? {}) as Record<string, Record<string, unknown>>;
                write({ ...extra, tools: { ...tools, [name]: { ...tools[name], enabled: true } } });
              }} />
              <span className="text-xs">Disabled in saved settings</span>
            </div>}
          </div>
          <Select value={mode} onValueChange={(value) => setMode(value as ToolApproval | "inherit", name)}>
            <SelectTrigger aria-label={`Approval for ${name}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Use default</SelectItem>
              <SelectItem value="auto">Run automatically</SelectItem>
              <SelectItem value="prompt">Ask in Control</SelectItem>
              <SelectItem value="deny">Block</SelectItem>
            </SelectContent>
          </Select>
        </div>;
      })}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Tool name for approval override" placeholder="Exact tool name" value={newTool} onChange={(event) => setNewTool(event.target.value)} />
        <Button type="button" variant="outline" disabled={!newTool.trim() || names.includes(newTool.trim())} onClick={() => { setMode("inherit", newTool.trim()); setNewTool(""); }}>Add tool rule</Button>
      </div>
      <p className="text-xs text-muted-foreground">Test the saved connection to list its tools, or enter an exact tool name.</p>
    </div>
  </section>;
}
