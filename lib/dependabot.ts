export const DEPENDABOT_ALERT_ACTIONS = [
  "created",
  "dismissed",
  "fixed",
  "reopened",
  "reintroduced",
  "auto_dismissed",
] as const;

export type DependabotAlertAction = (typeof DEPENDABOT_ALERT_ACTIONS)[number];

export function isDependabotAlertAction(
  value: unknown
): value is DependabotAlertAction {
  return (DEPENDABOT_ALERT_ACTIONS as readonly unknown[]).includes(value);
}

// Absence means the safe default. An explicit empty or invalid selection
// matches nothing; it must never silently re-enable remediation.
export function normalizeDependabotAlertActions(
  value: unknown
): DependabotAlertAction[] {
  if (value === undefined) return ["created"];
  return Array.isArray(value)
    ? [...new Set(value.filter(isDependabotAlertAction))]
    : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function handleDependabotAlert(body: Record<string, unknown>) {
  const action = nullableString(body.action);
  if (!action || !isDependabotAlertAction(action)) {
    return [];
  }

  const alert = record(body.alert);
  const dependency = record(alert.dependency);
  const dependencyPackage = record(dependency.package);
  const vulnerability = record(alert.security_vulnerability);
  const vulnerabilityPackage = record(vulnerability.package);
  const advisory = record(alert.security_advisory);
  const patchedVersion = record(vulnerability.first_patched_version);
  const identifiers = Array.isArray(advisory.identifiers)
    ? advisory.identifiers.flatMap((raw) => {
        const identifier = record(raw);
        const type = nullableString(identifier.type);
        const value = nullableString(identifier.value);
        return type && value ? [{ type, value }] : [];
      })
    : [];
  const alertNumber =
    typeof alert.number === "number" &&
    Number.isSafeInteger(alert.number) &&
    alert.number > 0
      ? alert.number
      : null;

  if (alertNumber === null) return [];

  return [
    {
      assignmentType: "dependabot_alert" as const,
      triggerEvent: "dependabot_alert" as const,
      metadata: {
        webhook_action: action,
        alert_number: alertNumber,
        alert_state: nullableString(alert.state),
        alert_url: nullableString(alert.html_url),
        dependency_package:
          nullableString(dependencyPackage.name) ||
          nullableString(vulnerabilityPackage.name),
        dependency_ecosystem:
          nullableString(dependencyPackage.ecosystem) ||
          nullableString(vulnerabilityPackage.ecosystem),
        manifest_path: nullableString(dependency.manifest_path),
        dependency_scope: nullableString(dependency.scope),
        dependency_relationship: nullableString(dependency.relationship),
        severity:
          nullableString(vulnerability.severity) ||
          nullableString(advisory.severity),
        ghsa_id: nullableString(advisory.ghsa_id),
        cve_id: nullableString(advisory.cve_id),
        identifiers,
        cves: [
          ...new Set(
            [
              nullableString(advisory.cve_id),
              ...identifiers
                .filter((identifier) => identifier.type.toUpperCase() === "CVE")
                .map((identifier) => identifier.value),
            ].filter((value): value is string => value !== null)
          ),
        ],
        vulnerable_version_range: nullableString(
          vulnerability.vulnerable_version_range
        ),
        vulnerable_requirements: nullableString(alert.vulnerable_requirements),
        first_patched_version: nullableString(patchedVersion.identifier),
        dismissed_at: nullableString(alert.dismissed_at),
        dismissed_reason: nullableString(alert.dismissed_reason),
        dismissed_comment: nullableString(alert.dismissed_comment),
        dismissed_by: nullableString(record(alert.dismissed_by).login),
        fixed_at: nullableString(alert.fixed_at),
        auto_dismissed_at: nullableString(alert.auto_dismissed_at),
      },
    },
  ];
}
