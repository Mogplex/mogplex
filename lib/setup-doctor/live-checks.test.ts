import { describe, expect, it } from "vitest";
import {
  checkSandboxesLive,
  checkTriggerLive,
  type DoctorFetch,
} from "./live-checks";

function recordingFetch(status: number | Error) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetcher: DoctorFetch = async (url, init) => {
    calls.push({ url, auth: new Headers(init.headers).get("authorization") });
    if (status instanceof Error) throw status;
    return new Response(null, { status });
  };
  return { calls, fetcher };
}

describe("checkTriggerLive", () => {
  it("should skip without a secret key", async () => {
    expect(
      (await checkTriggerLive({}, recordingFetch(200).fetcher)).status
    ).toBe("skip");
  });

  it("should pass when Trigger.dev accepts the key", async () => {
    const { calls, fetcher } = recordingFetch(200);
    const result = await checkTriggerLive(
      { TRIGGER_SECRET_KEY: "tr_prod_x" },
      fetcher
    );
    expect(result.status).toBe("pass");
    expect(calls[0]).toMatchObject({
      url: expect.stringMatching(/^https:\/\/api\.trigger\.dev\/api\/v1\/runs/),
      auth: "Bearer tr_prod_x",
    });
  });

  it("should call a self-hosted Trigger.dev instance", async () => {
    const { calls, fetcher } = recordingFetch(200);
    await checkTriggerLive(
      { TRIGGER_SECRET_KEY: "tr", TRIGGER_API_URL: "https://trigger.internal" },
      fetcher
    );
    expect(calls[0].url).toMatch(/^https:\/\/trigger\.internal\/api\/v1\/runs/);
  });

  it("should fail with the HTTP status when the key is rejected", async () => {
    const result = await checkTriggerLive(
      { TRIGGER_SECRET_KEY: "tr" },
      recordingFetch(401).fetcher
    );
    expect(result).toMatchObject({
      status: "fail",
      summary: expect.stringMatching(/HTTP 401/),
    });
  });

  it("should fail without echoing the key when the request throws", async () => {
    const result = await checkTriggerLive(
      { TRIGGER_SECRET_KEY: "tr_secret" },
      recordingFetch(new TypeError("fetch failed")).fetcher
    );
    expect(result.status).toBe("fail");
    expect(result.summary).not.toContain("tr_secret");
  });
});

describe("checkSandboxesLive", () => {
  it("should skip without both token and project", async () => {
    expect(
      (
        await checkSandboxesLive(
          { PLATFORM_VERCEL_TOKEN: "t" },
          recordingFetch(200).fetcher
        )
      ).status
    ).toBe("skip");
  });

  it("should read the project in the configured team", async () => {
    const { calls, fetcher } = recordingFetch(200);
    const result = await checkSandboxesLive(
      {
        PLATFORM_VERCEL_TOKEN: "t",
        VERCEL_PROJECT_ID: "prj_1",
        PLATFORM_VERCEL_TEAM_ID: "team_1",
      },
      fetcher
    );
    expect(result.status).toBe("pass");
    expect(calls[0].url).toBe(
      "https://api.vercel.com/v9/projects/prj_1?teamId=team_1"
    );
  });

  it("should fail when the token cannot read the project", async () => {
    const result = await checkSandboxesLive(
      { PLATFORM_VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "prj_1" },
      recordingFetch(403).fetcher
    );
    expect(result).toMatchObject({
      status: "fail",
      summary: expect.stringMatching(/HTTP 403/),
    });
  });
});
