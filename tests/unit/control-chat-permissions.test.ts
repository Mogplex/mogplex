import assert from "node:assert/strict";
import test from "node:test";
import { runAuthorizedControlChat } from "../../app/api/control/chat/_lib/authorized-request";

async function request(permissions: unknown) {
  // A malformed message lets accepted permission values continue through the
  // real handler without starting a provider run or touching a database.
  return runAuthorizedControlChat(
    new Request("http://localhost/api/control/chat", {
      method: "POST",
      body: JSON.stringify({
        permissions,
        messages: [{ role: "owner", parts: [] }],
      }),
    }),
    "user-1",
    { onCompletion: () => undefined }
  );
}

for (const permissions of [
  "skip permissions",
  " Skip Permissions",
  "Skip Permissions ",
  "approve edits",
  "",
  false,
  1,
  {},
  [],
]) {
  test(`Control rejects invalid permissions ${JSON.stringify(permissions)}`, async () => {
    const response = await request(permissions);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid control permissions.",
    });
  });
}

for (const permissions of [
  "Skip Permissions",
  "Approve Edits",
  null,
  undefined,
]) {
  test(`Control accepts permissions ${String(permissions)}`, async () => {
    const response = await request(permissions);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid control chat message role.",
    });
  });
}
