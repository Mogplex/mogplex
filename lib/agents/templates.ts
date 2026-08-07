/**
 * Preconfigured agent templates catalog.
 *
 * Templates are organized by category in ./templates/<category>.ts.
 * This file re-exports the composed catalog for backward compatibility.
 */
export {
  AGENT_CATEGORIES,
  type AgentCategory,
  PRECONFIGURED_AGENTS,
  type PreconfiguredAgentName,
} from "./templates/index";
