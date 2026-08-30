import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { getSlackSigningFixture } from "../support/slack-signing-fixture";

const SIGNING_FIXTURE = getSlackSigningFixture();

function signedHeaders(rawBody: string) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = `v0=${crypto
    .createHmac("sha256", SIGNING_FIXTURE)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
  return {
    "content-type": "application/x-www-form-urlencoded",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  };
}

test("Slack command webhook gives malformed commands a help recovery", async ({
  request,
}) => {
  const rawBody = new URLSearchParams({
    command: "/mogplex",
    text: "help",
    team_id: "T_UNKNOWN",
  }).toString();

  const response = await request.post("/api/webhooks/slack", {
    data: rawBody,
    headers: signedHeaders(rawBody),
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    response_type: "ephemeral",
    text: expect.stringMatching(/\/mogplex help/),
  });
});
