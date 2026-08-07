"use client"

// Re-export all inspector components for backward compatibility
// This file consolidates the split modules into a single import point

export {
  WorkflowSelect,
  WorkflowCombobox,
  InspectorCallout,
  InspectorField,
  InspectorSummaryItem,
} from "./inspector-shared"

export {
  installationAccountTypeLabel,
  installationAccountLabel,
  buildFilter,
  RepositoryScopePicker,
  StartFilterFields,
  ExternalTriggerTestPanel,
} from "./start-filter-fields"
