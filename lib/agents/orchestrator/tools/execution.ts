/**
 * Execution tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Tool definitions ---

export const EXECUTION_TOOLS: OrchestratorToolDef[] = [
  {
    name: "run_command",
    category: "execution",
    description: "Execute a shell command in the sandbox",
    access: "mutation",
    implemented: true,
  },
  {
    name: "run_checks",
    category: "execution",
    description: "Run lint, typecheck, and test commands",
    access: "mutation",
    implemented: false,
  },
  {
    name: "run_bench",
    category: "execution",
    description: "Run benchmarks and collect metrics",
    access: "mutation",
    implemented: false,
  },
  {
    name: "replay_span",
    category: "execution",
    description: "Replay an observability span for debugging",
    access: "read",
    implemented: false,
  },
  {
    name: "start_dev_server",
    category: "execution",
    description: "Start the development server in the sandbox",
    access: "mutation",
    implemented: false,
  },
  {
    name: "http_probe",
    category: "execution",
    description: "Make an HTTP request to test an endpoint",
    access: "read",
    implemented: false,
  },
];

// --- Schemas ---

export const runChecksSchema = z.object({
  commands: z.array(z.string()).optional().describe("Specific check commands"),
});

export const runBenchSchema = z.object({
  benchmark: z.string().describe("Benchmark name or path"),
  iterations: z.number().optional().describe("Number of iterations"),
});

export const replaySpanSchema = z.object({
  spanId: z.string().describe("Span ID to replay"),
});

export const startDevServerSchema = z.object({
  port: z.number().optional().describe("Port to use"),
});

export const httpProbeSchema = z.object({
  url: z.string().describe("URL to probe"),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "HEAD"])
    .optional()
    .describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Request headers"),
  body: z.string().optional().describe("Request body"),
});

// --- Schema map for stub tools ---

export const EXECUTION_SCHEMAS: Record<string, z.ZodType> = {
  run_checks: runChecksSchema,
  run_bench: runBenchSchema,
  replay_span: replaySpanSchema,
  start_dev_server: startDevServerSchema,
  http_probe: httpProbeSchema,
};
