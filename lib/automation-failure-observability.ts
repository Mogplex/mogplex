export type AutomationFailureClass =
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "dependency_unavailable"
  | "authentication"
  | "configuration"
  | "unknown";

export type AutomationFailureTimeoutBucket =
  | "under_3m"
  | "under_5m"
  | "5m_plus"
  | "unknown";

export type AutomationFailureDiagnostics = {
  failureClass: AutomationFailureClass | null;
  failureLabel: string | null;
  failureMessage: string | null;
  failureStatusCode: number | null;
  executionPhase: string | null;
  effectiveTimeoutMs: number | null;
  timeoutBucket: AutomationFailureTimeoutBucket;
  timeoutBucketLabel: string;
  retryAttempted: boolean;
  retryCount: number;
  attempts: number;
  recoveredFromFailureClass: AutomationFailureClass | null;
  recoveredFromFailureLabel: string | null;
  recoveredFromMessage: string | null;
};

export type AutomationFailureBreakdown = {
  key: string;
  label: string;
  count: number;
};

export type AutomationFailureRecord = {
  id: string;
  jobRunId: string | null;
  createdAt: string;
  sourceKind: "assignment" | "trigger" | "flow" | "manual_retry";
  sourceType: string;
  reason: string | null;
  reasonLabel: string;
  outcome: "completed" | "failed";
  repo: {
    id: string | null;
    fullName: string | null;
  };
  agent: {
    id: string | null;
    name: string | null;
    slug: string | null;
    model: string | null;
    provider: string | null;
  };
  diagnostics: AutomationFailureDiagnostics;
  metadata: Record<string, unknown> | null;
};

export type AutomationFailureFilterOptions = {
  failureClasses: Array<{ value: AutomationFailureClass; label: string }>;
  sourceTypes: Array<{ value: string; label: string }>;
  providers: Array<{ value: string; label: string }>;
  models: Array<{ value: string; label: string }>;
};

export type AutomationFailureFiltersInput = {
  failureClass?: string;
  sourceType?: string;
  provider?: string;
  model?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown) {
  return value === true;
}

function toCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function formatAutomationFailureClassLabel(
  value: AutomationFailureClass | null | undefined
) {
  switch (value) {
    case "timeout":
      return "Timeout";
    case "rate_limited":
      return "Rate limited";
    case "provider_unavailable":
      return "Provider unavailable";
    case "dependency_unavailable":
      return "Dependency unavailable";
    case "authentication":
      return "Authentication";
    case "configuration":
      return "Configuration";
    case "unknown":
      return "Other";
    default:
      return null;
  }
}

function toAutomationFailureClass(
  value: unknown
): AutomationFailureClass | null {
  switch (value) {
    case "timeout":
    case "rate_limited":
    case "provider_unavailable":
    case "dependency_unavailable":
    case "authentication":
    case "configuration":
    case "unknown":
      return value;
    default:
      return null;
  }
}

export function deriveAutomationProvider(model: string | null | undefined) {
  const normalizedModel = toOptionalString(model);
  if (!normalizedModel) return null;

  const [provider] = normalizedModel.split("/");
  return provider ? provider.toLowerCase() : null;
}

export function formatAutomationProviderLabel(
  provider: string | null | undefined
) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "minimax":
      return "MiniMax";
    default:
      return provider
        ? provider
            .replaceAll("_", " ")
            .replace(/\b\w/g, (char) => char.toUpperCase())
        : null;
  }
}

export function getAutomationTimeoutBucket(
  timeoutMs: number | null | undefined
) {
  if (timeoutMs == null || timeoutMs <= 0) {
    return {
      key: "unknown" as const,
      label: "Unknown",
    };
  }

  if (timeoutMs < 180_000) {
    return {
      key: "under_3m" as const,
      label: "< 3m",
    };
  }

  if (timeoutMs < 300_000) {
    return {
      key: "under_5m" as const,
      label: "3m-4.9m",
    };
  }

  return {
    key: "5m_plus" as const,
    label: "5m+",
  };
}

export function presentAutomationFailureDiagnostics(
  metadata: Record<string, unknown> | null | undefined
): AutomationFailureDiagnostics {
  const normalizedMetadata = isRecord(metadata) ? metadata : null;
  const failureClass = toAutomationFailureClass(
    normalizedMetadata?.model_failure_class
  );
  const recoveredFromFailureClass = toAutomationFailureClass(
    normalizedMetadata?.model_recovered_from_failure_class
  );
  const effectiveTimeoutMs = toOptionalNumber(
    normalizedMetadata?.model_effective_timeout_ms
  );
  const timeoutBucket = getAutomationTimeoutBucket(effectiveTimeoutMs);

  return {
    failureClass,
    failureLabel: formatAutomationFailureClassLabel(failureClass),
    failureMessage: toOptionalString(normalizedMetadata?.model_failure_message),
    failureStatusCode: toOptionalNumber(
      normalizedMetadata?.model_failure_status_code
    ),
    executionPhase: toOptionalString(normalizedMetadata?.model_execution_phase),
    effectiveTimeoutMs,
    timeoutBucket: timeoutBucket.key,
    timeoutBucketLabel: timeoutBucket.label,
    retryAttempted: toBoolean(normalizedMetadata?.model_retry_attempted),
    retryCount: toCount(normalizedMetadata?.model_retry_count),
    attempts: toCount(normalizedMetadata?.model_attempts),
    recoveredFromFailureClass,
    recoveredFromFailureLabel: formatAutomationFailureClassLabel(
      recoveredFromFailureClass
    ),
    recoveredFromMessage: toOptionalString(
      normalizedMetadata?.model_recovered_from_message
    ),
  };
}

function sortBreakdowns(
  input: Map<string, { label: string; count: number }>
): AutomationFailureBreakdown[] {
  return Array.from(input.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
}

export function buildAutomationFailureFilterOptions(
  records: AutomationFailureRecord[]
): AutomationFailureFilterOptions {
  const failureClasses = new Map<AutomationFailureClass, string>();
  const sourceTypes = new Map<string, string>();
  const providers = new Map<string, string>();
  const models = new Map<string, string>();

  for (const record of records) {
    const failureClass = record.diagnostics.failureClass ?? "unknown";
    failureClasses.set(
      failureClass,
      formatAutomationFailureClassLabel(failureClass) ?? "Other"
    );

    if (record.sourceType) {
      sourceTypes.set(record.sourceType, record.sourceType);
    }

    if (record.agent.provider) {
      providers.set(
        record.agent.provider,
        formatAutomationProviderLabel(record.agent.provider) ??
          record.agent.provider
      );
    }

    if (record.agent.model) {
      models.set(record.agent.model, record.agent.model);
    }
  }

  return {
    failureClasses: Array.from(failureClasses.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    sourceTypes: Array.from(sourceTypes.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    providers: Array.from(providers.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    models: Array.from(models.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  };
}

export function filterAutomationFailureRecords(
  records: AutomationFailureRecord[],
  filters: AutomationFailureFiltersInput
) {
  return records.filter((record) => {
    if (
      filters.failureClass &&
      (record.diagnostics.failureClass ?? "unknown") !== filters.failureClass
    ) {
      return false;
    }

    if (filters.sourceType && record.sourceType !== filters.sourceType) {
      return false;
    }

    if (filters.provider && record.agent.provider !== filters.provider) {
      return false;
    }

    if (filters.model && record.agent.model !== filters.model) {
      return false;
    }

    return true;
  });
}

export function buildAutomationFailureBreakdowns(
  records: AutomationFailureRecord[]
) {
  const byFailureClass = new Map<string, { label: string; count: number }>();
  const bySourceType = new Map<string, { label: string; count: number }>();
  const byProvider = new Map<string, { label: string; count: number }>();
  const byModel = new Map<string, { label: string; count: number }>();
  const byTimeoutBucket = new Map<string, { label: string; count: number }>();

  for (const record of records) {
    const failureClass = record.diagnostics.failureClass ?? "unknown";
    const failureLabel =
      formatAutomationFailureClassLabel(failureClass) ?? "Other";
    const failureEntry = byFailureClass.get(failureClass) ?? {
      label: failureLabel,
      count: 0,
    };
    failureEntry.count += 1;
    byFailureClass.set(failureClass, failureEntry);

    const sourceTypeLabel = record.sourceType;
    const sourceTypeEntry = bySourceType.get(record.sourceType) ?? {
      label: sourceTypeLabel,
      count: 0,
    };
    sourceTypeEntry.count += 1;
    bySourceType.set(record.sourceType, sourceTypeEntry);

    const providerKey = record.agent.provider ?? "unknown";
    const providerEntry = byProvider.get(providerKey) ?? {
      label: formatAutomationProviderLabel(record.agent.provider) ?? "Unknown",
      count: 0,
    };
    providerEntry.count += 1;
    byProvider.set(providerKey, providerEntry);

    const modelKey = record.agent.model ?? "unknown";
    const modelEntry = byModel.get(modelKey) ?? {
      label: record.agent.model ?? "Unknown",
      count: 0,
    };
    modelEntry.count += 1;
    byModel.set(modelKey, modelEntry);

    const timeoutKey = record.diagnostics.timeoutBucket;
    const timeoutEntry = byTimeoutBucket.get(timeoutKey) ?? {
      label: record.diagnostics.timeoutBucketLabel,
      count: 0,
    };
    timeoutEntry.count += 1;
    byTimeoutBucket.set(timeoutKey, timeoutEntry);
  }

  return {
    byFailureClass: sortBreakdowns(byFailureClass),
    bySourceType: sortBreakdowns(bySourceType),
    byProvider: sortBreakdowns(byProvider),
    byModel: sortBreakdowns(byModel),
    byTimeoutBucket: sortBreakdowns(byTimeoutBucket),
  };
}

export function summarizeAutomationResilience(
  records: AutomationFailureRecord[]
) {
  const failedRecords = records.filter((record) => record.outcome === "failed");
  const completedRecords = records.filter(
    (record) => record.outcome === "completed"
  );

  return {
    failedTotal: failedRecords.length,
    successfulRecoveries: completedRecords.filter(
      (record) => record.diagnostics.recoveredFromFailureClass !== null
    ).length,
    retriedFailures: failedRecords.filter(
      (record) => record.diagnostics.retryAttempted
    ).length,
    timeoutFailures: failedRecords.filter(
      (record) => record.diagnostics.failureClass === "timeout"
    ).length,
    authenticationFailures: failedRecords.filter(
      (record) => record.diagnostics.failureClass === "authentication"
    ).length,
    configurationFailures: failedRecords.filter(
      (record) => record.diagnostics.failureClass === "configuration"
    ).length,
    providerFailures: failedRecords.filter(
      (record) =>
        record.diagnostics.failureClass === "provider_unavailable" ||
        record.diagnostics.failureClass === "rate_limited"
    ).length,
    // Counted separately rather than folded into providerFailures: these are
    // our own dependencies failing, so they point at a Mogplex/Supabase problem
    // rather than at the model provider.
    dependencyFailures: failedRecords.filter(
      (record) => record.diagnostics.failureClass === "dependency_unavailable"
    ).length,
  };
}
