// @vitest-environment jsdom

import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineEnvVarForm, StatusOverlay } from "@/components/preview-pane";
import { setActiveTeamIdForRequests } from "@/components/active-scope-provider";
import { ACTIVE_TEAM_HEADER } from "@/lib/team-capabilities";

describe("preview missing-environment recovery", () => {
  afterEach(() => {
    cleanup();
    setActiveTeamIdForRequests(null);
    vi.unstubAllGlobals();
  });

  it("shows the inline recovery form when only the application error names the missing variable", () => {
    render(
      createElement(StatusOverlay, {
        status: "app_error",
        error: {
          code: "UNKNOWN",
          message: "Error: AUTH_SECRET env var is not set",
        },
        repoId: "repo-1",
      })
    );

    expect(
      screen.getByText("Missing auth secret environment variable")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save & restart" })).toBeTruthy();
  });

  it("preserves active team scope while loading and saving repo environment variables", async () => {
    setActiveTeamIdForRequests("team-1");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([{ id: "repo-1", sandbox_env_vars: {} }])
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();

    render(createElement(InlineEnvVarForm, { repoId: "repo-1", onSaved }));
    fireEvent.change(screen.getByPlaceholderText(/MISSING_VAR=value/), {
      target: { value: "AUTH_SECRET=secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & restart" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get(ACTIVE_TEAM_HEADER)).toBe("team-1");
    }
  });
});
