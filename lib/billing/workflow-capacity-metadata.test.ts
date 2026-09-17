import { expect, it } from "vitest";
import { workflowCapacityMetadata } from "./workflow-capacity-metadata";
import type { WorkflowCapacityAdmissionDecision } from "./workflow-capacity";

const pressure: WorkflowCapacityAdmissionDecision = {
  tracked: true,
  accountId: "account",
  posted: true,
  admitted: true,
  wouldAdmit: false,
  activeBefore: 2,
  concurrencyLimit: 0,
  accountingMode: "shadow",
};

it("marks shadow over-capacity runs as admitted without enforcement", () => {
  expect(workflowCapacityMetadata(pressure)).toMatchObject({
    capacity_accounting_mode: "shadow",
    capacity_admitted: true,
    capacity_enforcement_active: false,
    capacity_would_admit: false,
    active_concurrency_before: 2,
    concurrency_limit: 0,
  });
});
it("distinguishes enforcing rejections and successful enforcing admissions", () => {
  expect(
    workflowCapacityMetadata({
      ...pressure,
      accountingMode: "enforced",
      admitted: false,
    })
  ).toMatchObject({
    capacity_admitted: false,
    capacity_enforcement_active: true,
    capacity_would_admit: false,
  });
  expect(
    workflowCapacityMetadata({
      ...pressure,
      accountingMode: "enforced",
      admitted: true,
      wouldAdmit: true,
    })
  ).toMatchObject({
    capacity_admitted: true,
    capacity_enforcement_active: true,
    capacity_would_admit: true,
  });
});
it("identifies meter-only and unresolved decisions without implying enforcement", () => {
  expect(
    workflowCapacityMetadata({ ...pressure, accountingMode: "meter_only" })
  ).toMatchObject({
    capacity_admitted: true,
    capacity_enforcement_active: false,
  });
  expect(workflowCapacityMetadata({ ...pressure, tracked: false })).toEqual({
    capacity_tracking: "unresolved_scope",
  });
});
