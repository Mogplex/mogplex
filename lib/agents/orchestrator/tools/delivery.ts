/**
 * Delivery tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Tool definitions ---

export const DELIVERY_TOOLS: OrchestratorToolDef[] = [
  {
    name: "deploy",
    category: "delivery",
    description: "Deploy to a target environment (requires approval)",
    access: "approval",
    implemented: false,
  },
  {
    name: "promote",
    category: "delivery",
    description:
      "Promote a deployment to the next environment (requires approval)",
    access: "approval",
    implemented: false,
  },
  {
    name: "rollback",
    category: "delivery",
    description: "Rollback to a previous deployment (requires approval)",
    access: "approval",
    implemented: false,
  },
  {
    name: "query_deployment_health",
    category: "delivery",
    description: "Check the health of a deployment",
    access: "read",
    implemented: false,
  },
  {
    name: "feature_flag_set",
    category: "delivery",
    description: "Set a feature flag value (requires approval)",
    access: "approval",
    implemented: false,
  },
];

// --- Schemas ---

export const deploySchema = z.object({
  environment: z.string().describe("Target environment"),
  version: z.string().optional().describe("Version to deploy"),
});

export const promoteSchema = z.object({
  fromEnvironment: z.string().describe("Source environment"),
  toEnvironment: z.string().describe("Target environment"),
});

export const rollbackSchema = z.object({
  environment: z.string().describe("Environment"),
  toVersion: z.string().describe("Version to rollback to"),
});

export const queryDeploymentHealthSchema = z.object({
  environment: z.string().describe("Environment to check"),
  deploymentId: z.string().optional().describe("Specific deployment"),
});

export const featureFlagSetSchema = z.object({
  flag: z.string().describe("Flag name"),
  value: z.union([z.boolean(), z.string(), z.number()]).describe("Flag value"),
  environment: z.string().optional().describe("Environment scope"),
});

// --- Schema map for stub tools ---

export const DELIVERY_SCHEMAS: Record<string, z.ZodType> = {
  deploy: deploySchema,
  promote: promoteSchema,
  rollback: rollbackSchema,
  query_deployment_health: queryDeploymentHealthSchema,
  feature_flag_set: featureFlagSetSchema,
};
