import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatGitDeliveryCommand,
  createChatGitDeliveryPreparer,
} from "../../lib/agents/chat-git-delivery";

test("chat git delivery checks out and publishes the isolated branch before the model runs", async () => {
  let requestUrl = "";
  let requestBody: { command?: string } = {};
  let requestAccept = "";
  const prepare = createChatGitDeliveryPreparer({
    buildInternalApiHeaders: () => ({
      "Content-Type": "application/json",
      "x-test-user": "user-123",
    }),
    fetch: async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as { command?: string };
      requestAccept = new Headers(init?.headers).get("Accept") ?? "";
      return Response.json({ exitCode: 0, stdout: "", stderr: "" });
    },
  });

  await prepare({
    userId: "user-123",
    sandboxId: "sandbox/legacy",
    baseBranch: "main",
    workingBranch: "mogplex/agent-sandbox-legacy",
  });

  assert.equal(
    requestUrl,
    "http://localhost:3000/api/sandbox/sandbox%2Flegacy/exec"
  );
  assert.equal(requestAccept, "application/json");
  assert.match(requestBody.command ?? "", /MOGPLEX_BASE_BRANCH='main'/);
  assert.match(
    requestBody.command ?? "",
    /git checkout -b "\$MOGPLEX_WORKING_BRANCH" "origin\/\$MOGPLEX_BASE_BRANCH"/
  );
  assert.match(
    requestBody.command ?? "",
    /git push -u origin "\$MOGPLEX_WORKING_BRANCH"/
  );
});

test("chat git delivery fails closed when branch preparation fails", async () => {
  const prepare = createChatGitDeliveryPreparer({
    buildInternalApiHeaders: () => ({ "Content-Type": "application/json" }),
    fetch: async () =>
      Response.json({ exitCode: 1, stderr: "Not possible to fast-forward" }),
  });

  await assert.rejects(
    prepare({
      userId: "user-123",
      sandboxId: "sandbox-123",
      baseBranch: "main",
      workingBranch: "feature/diverged",
    }),
    /Resolve the branch in Terminal or start a new sandbox/
  );
});

test("chat git delivery shell-quotes branch names before validation", () => {
  const command = buildChatGitDeliveryCommand({
    baseBranch: "main'; touch /tmp/pwned; echo '",
    workingBranch: "feature/safe",
  });

  assert.match(
    command,
    /MOGPLEX_BASE_BRANCH='main'\\''; touch \/tmp\/pwned; echo '\\'''/
  );
});
