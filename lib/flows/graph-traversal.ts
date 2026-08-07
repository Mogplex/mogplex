import type { FlowGraph } from "@/lib/types";

export type GraphAdjacency = {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
};

export function buildAdjacency(graph: FlowGraph): GraphAdjacency {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of graph.edges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  return { outgoing, incoming };
}

export function reachableFrom(
  startId: string,
  outgoing: Map<string, string[]>
): Set<string> {
  const seen = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of outgoing.get(current) || []) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  return seen;
}

export function reverseReachableFrom(
  endId: string,
  incoming: Map<string, string[]>
): Set<string> {
  const seen = new Set<string>();
  const queue = [endId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const prev of incoming.get(current) || []) {
      if (!seen.has(prev)) queue.push(prev);
    }
  }

  return seen;
}
