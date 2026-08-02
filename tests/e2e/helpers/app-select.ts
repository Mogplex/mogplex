import type { Locator } from "@playwright/test";

function attributeValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function selectAppOption(trigger: Locator, value: string) {
  await trigger.click();
  await trigger
    .page()
    .locator(`[role="option"][data-value="${attributeValue(value)}"]`)
    .click();
}
