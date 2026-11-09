const BREAKER_FAILURE_LIMIT = 5;
const BREAKER_OPEN_MS = 60_000;

type BreakerScope = {
  failures: number;
  openUntil: number;
};

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { status?: unknown; statusCode?: unknown };
  const status = value.status ?? value.statusCode;
  return typeof status === "number" ? status : null;
}

export function isSystemicEvaluationFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "TimeoutError") return true;
  const status = errorStatus(error);
  return status === null || status >= 500;
}

export function createDecisionCircuitBreaker() {
  const scopes = new Map<string, BreakerScope>();

  return {
    isOpen(model: string, now: number) {
      return now < (scopes.get(model)?.openUntil ?? 0);
    },
    noteResult(model: string, ok: boolean, error: unknown, now: number) {
      if (ok) {
        scopes.delete(model);
        return;
      }
      if (!isSystemicEvaluationFailure(error)) return;
      const scope = scopes.get(model) ?? { failures: 0, openUntil: 0 };
      scope.failures += 1;
      if (scope.failures >= BREAKER_FAILURE_LIMIT) {
        scope.openUntil = now + BREAKER_OPEN_MS;
        scope.failures = 0;
      }
      scopes.set(model, scope);
    },
    reset() {
      scopes.clear();
    },
  };
}

export const decisionCircuitBreaker = createDecisionCircuitBreaker();
