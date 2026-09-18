import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";

for (const stream of [true, false]) {
  test(`CLI rejects malformed image URLs before inference (stream=${stream})`, async ({
    request,
  }) => {
    const response = await request.post("/api/cli/inference/chat/completions", {
      headers: buildE2EAuthHeaders(),
      data: {
        model: "openai/gpt-4o",
        stream,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "not a valid URL" } },
            ],
          },
        ],
      },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "Invalid chat message content" },
    });
  });
}
