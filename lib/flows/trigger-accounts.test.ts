import { describe, expect, it } from "vitest";
import type { FlowStartFilter } from "@/lib/types";
import { evaluateTriggerFilter } from "./trigger-filter";
import {
  buildTriggerFilter,
  describeTriggerAccounts,
  pruneReposToInstallations,
  resolveTriggerInstallationIds,
  triggerCoversInstallation,
} from "./trigger-accounts";

const MOGPLEX = 150_968_809;
const WEBRENEW = 150_970_410;
const PERSONAL = 126_303_866;

const INSTALLATIONS = [
  {
    installation_id: MOGPLEX,
    account_login: "Mogplex",
    repositories: [{ full_name: "Mogplex/mogplex" }],
  },
  {
    installation_id: WEBRENEW,
    account_login: "webrenew",
    repositories: [{ full_name: "webrenew/vmotif" }],
  },
  {
    installation_id: PERSONAL,
    account_login: "charlesrhoward",
    repositories: [{ full_name: "charlesrhoward/h1b-bench" }],
  },
];

describe("resolveTriggerInstallationIds", () => {
  it("should report every listed account for a multi-account GitHub trigger", () => {
    const filter: FlowStartFilter = {
      scope: "all",
      installationIds: [MOGPLEX, WEBRENEW],
    };
    const start = { event: "pr_opened", filter };
    // flows.installation_id is Mogplex, but routing ignores it for GitHub
    // events; the editor showed "Mogplex" only because it fell back to it.
    expect(resolveTriggerInstallationIds(start, MOGPLEX)).toEqual([
      MOGPLEX,
      WEBRENEW,
    ]);
  });

  it("should report all accounts when a GitHub trigger has no installationIds", () => {
    expect(resolveTriggerInstallationIds({ event: "pr_opened" }, MOGPLEX)).toBe(
      null
    );
  });

  it("should bind single-repository triggers to the flow installation", () => {
    expect(
      resolveTriggerInstallationIds({ event: "schedule" }, WEBRENEW)
    ).toEqual([WEBRENEW]);
    expect(
      resolveTriggerInstallationIds(
        {
          event: "webhook",
          filter: { scope: "all", installationIds: [PERSONAL] },
        },
        WEBRENEW
      )
    ).toEqual([PERSONAL]);
    expect(
      resolveTriggerInstallationIds({ event: "slack_mention" }, null)
    ).toEqual([]);
  });

  it("should bind a flow without a start node to its own installation", () => {
    expect(resolveTriggerInstallationIds(null, WEBRENEW)).toEqual([WEBRENEW]);
    expect(resolveTriggerInstallationIds(null, undefined)).toEqual([]);
  });

  it("should agree with webhook routing for every account and scope", () => {
    const accountTypes = new Map([
      [MOGPLEX, "Organization"],
      [WEBRENEW, "Organization"],
      [PERSONAL, "User"],
    ] as const);
    const filters: Array<FlowStartFilter | undefined> = [
      undefined,
      { scope: "all" },
      { scope: "org" },
      { scope: "personal" },
      { scope: "all", installationIds: [MOGPLEX, WEBRENEW] },
      { scope: "all", installationIds: [PERSONAL] },
      { scope: "org", installationIds: [WEBRENEW, PERSONAL] },
    ];
    for (const filter of filters) {
      const ids = resolveTriggerInstallationIds(
        { event: "pr_opened", filter },
        MOGPLEX
      );
      for (const [installationId, accountType] of accountTypes) {
        expect(
          triggerCoversInstallation(ids, installationId, {
            scope: filter?.scope,
            accountType,
          })
        ).toBe(
          evaluateTriggerFilter(filter, {
            installationId,
            repoFullName: null,
            accountType,
          })
        );
      }
    }
  });
});

describe("buildTriggerFilter", () => {
  it("should omit installationIds when the trigger covers all accounts", () => {
    expect(buildTriggerFilter([], [], "exclude_dependabot")).toEqual({
      scope: "all",
      authorFilter: "exclude_dependabot",
    });
    expect(buildTriggerFilter([], [], "any")).toBeUndefined();
  });

  it("should keep an org or personal scope", () => {
    expect(buildTriggerFilter([], [], "any", "org")).toEqual({ scope: "org" });
    expect(
      buildTriggerFilter([], ["webrenew/vmotif"], "any", "personal")
    ).toEqual({ scope: "personal", repos: ["webrenew/vmotif"] });
  });

  it("should keep every selected account", () => {
    expect(
      buildTriggerFilter([MOGPLEX, WEBRENEW], ["webrenew/vmotif"], "any")
    ).toEqual({
      scope: "all",
      installationIds: [MOGPLEX, WEBRENEW],
      repos: ["webrenew/vmotif"],
    });
  });
});

describe("pruneReposToInstallations", () => {
  it("should drop repositories outside the selected accounts", () => {
    expect(
      pruneReposToInstallations(
        ["webrenew/vmotif", "Mogplex/mogplex"],
        [MOGPLEX],
        INSTALLATIONS
      )
    ).toEqual(["Mogplex/mogplex"]);
  });

  it("should keep every repository when all accounts are selected", () => {
    const repos = ["webrenew/vmotif", "someone/unsynced"];
    expect(pruneReposToInstallations(repos, [], INSTALLATIONS)).toEqual(repos);
  });

  it("should match repository names case-insensitively", () => {
    expect(
      pruneReposToInstallations(["mogplex/MOGPLEX"], [MOGPLEX], INSTALLATIONS)
    ).toEqual(["mogplex/MOGPLEX"]);
  });
});

describe("describeTriggerAccounts", () => {
  it("should name the accounts a trigger runs on", () => {
    expect(describeTriggerAccounts(null, INSTALLATIONS)).toBe("All accounts");
    expect(describeTriggerAccounts([MOGPLEX], INSTALLATIONS)).toBe("Mogplex");
    expect(describeTriggerAccounts([MOGPLEX, WEBRENEW], INSTALLATIONS)).toBe(
      "Mogplex, webrenew"
    );
    expect(
      describeTriggerAccounts([MOGPLEX, WEBRENEW, PERSONAL], INSTALLATIONS)
    ).toBe("3 accounts");
  });

  it("should name an org or personal scope", () => {
    expect(describeTriggerAccounts(null, INSTALLATIONS, "org")).toBe(
      "All organizations"
    );
    expect(describeTriggerAccounts(null, INSTALLATIONS, "personal")).toBe(
      "All personal accounts"
    );
    expect(describeTriggerAccounts([MOGPLEX], INSTALLATIONS, "org")).toBe(
      "Mogplex (organizations only)"
    );
  });

  it("should fall back to the installation id for unknown or unnamed accounts", () => {
    expect(describeTriggerAccounts([42], INSTALLATIONS)).toBe(
      "Installation 42"
    );
    expect(
      describeTriggerAccounts(
        [7],
        [{ installation_id: 7, account_login: null }]
      )
    ).toBe("Installation 7");
    expect(describeTriggerAccounts([], INSTALLATIONS)).toBe("No account");
  });
});
