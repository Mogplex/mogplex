import { expect, test } from "@playwright/test";
import { selectAppOption } from "./helpers/app-select";
import {
  setupWorkflowsPage,
  fulfillJson,
} from "./helpers/flows-pane-theme-fixtures";

function sourceHandle(page: import("@playwright/test").Page, id: string) {
  return page.locator(
    `.react-flow__node-classify .react-flow__handle.source[data-handleid="${id}"]`
  );
}

test("a Classify node exposes one branch per answer and can test its question", async ({
  page,
}) => {
  await setupWorkflowsPage(page, "dark");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  await page.getByPlaceholder("Search nodes…").fill("classify");
  await page.getByTestId("flow-library-add-classify").click();

  const inspector = page.locator(".flows-inspector");
  await expect(inspector).toContainText("Classify operator");
  const node = page.locator(".react-flow__node-classify");
  await expect(node).toContainText("True");
  await expect(node).toContainText("False");
  await expect(sourceHandle(page, "true")).toHaveCount(1);
  await expect(sourceHandle(page, "false")).toHaveCount(1);
  await expect(sourceHandle(page, "error")).toHaveCount(1);

  await inspector.getByLabel("Question").fill("Which kind of issue is this?");
  await expect(node).toContainText("Which kind of issue is this?");

  await selectAppOption(inspector.getByLabel("Answer type"), "choice");
  await inspector.getByLabel("Option 1", { exact: true }).fill("Bug report");
  await inspector
    .getByLabel("Option 2", { exact: true })
    .fill("Feature request");
  await inspector.getByRole("button", { name: "Add option" }).click();
  await inspector.getByLabel("Option 3", { exact: true }).fill("Question");

  await expect(node).toContainText("Bug report");
  await expect(node).toContainText("Question");
  await expect(sourceHandle(page, "true")).toHaveCount(0);
  await expect(sourceHandle(page, "option:option_1")).toHaveCount(1);
  await expect(sourceHandle(page, "option:option_3")).toHaveCount(1);

  await inspector.getByRole("button", { name: "Remove option 3" }).click();
  await expect(sourceHandle(page, "option:option_3")).toHaveCount(0);

  await expect(sourceHandle(page, "uncertain")).toHaveCount(0);
  await inspector.getByLabel("Minimum confidence").fill("70");
  await expect(sourceHandle(page, "uncertain")).toHaveCount(1);
  await expect(node).toContainText("Uncertain");

  let testRequest: Record<string, unknown> | null = null;
  await page.route("**/api/flows/classify-test", async (route) => {
    testRequest = route.request().postDataJSON() as Record<string, unknown>;
    await fulfillJson(route, {
      result: {
        kind: "choice",
        answer: "Bug report",
        optionId: "option_1",
        confidence: 0.92,
        probabilities: { "Bug report": 0.92, "Feature request": 0.08 },
        uncertain: false,
      },
    });
  });

  const runTest = page.getByTestId("classify-test-run");
  await expect(runTest).toBeDisabled();
  await inspector
    .getByLabel("Sample state")
    .fill("Login page crashes on submit");
  await runTest.click();

  const result = page.getByTestId("classify-test-result");
  await expect(result).toContainText("Bug report");
  await expect(result).toContainText("92% confidence");
  await expect(result).toContainText("8%");
  expect(testRequest).toMatchObject({
    question: "Which kind of issue is this?",
    state: "Login page crashes on submit",
    minConfidence: 0.7,
    output: {
      kind: "choice",
      options: [
        { id: "option_1", label: "Bug report" },
        { id: "option_2", label: "Feature request" },
      ],
    },
  });

  await selectAppOption(inspector.getByLabel("Answer type"), "scale");
  await expect(node).toContainText("Scale 1 to 3");
  await expect(sourceHandle(page, "option:option_1")).toHaveCount(0);
});
