import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTriggerFilter,
  normalizeAccountType,
  type TriggerFilterContext,
} from "../../lib/flows/trigger-filter";

const orgCtx: TriggerFilterContext = {
  installationId: 1001,
  repoFullName: "acme/web",
  accountType: "Organization",
};

const userCtx: TriggerFilterContext = {
  installationId: 2002,
  repoFullName: "alice/dotfiles",
  accountType: "User",
};

test("undefined filter passes through (parity with pre-filter behavior)", () => {
  assert.equal(evaluateTriggerFilter(undefined, orgCtx), true);
  assert.equal(evaluateTriggerFilter(undefined, userCtx), true);
});

test("scope=all matches both account types", () => {
  assert.equal(evaluateTriggerFilter({ scope: "all" }, orgCtx), true);
  assert.equal(evaluateTriggerFilter({ scope: "all" }, userCtx), true);
});

test("scope=org matches only Organization installations", () => {
  assert.equal(evaluateTriggerFilter({ scope: "org" }, orgCtx), true);
  assert.equal(evaluateTriggerFilter({ scope: "org" }, userCtx), false);
});

test("scope=personal matches only User installations", () => {
  assert.equal(evaluateTriggerFilter({ scope: "personal" }, orgCtx), false);
  assert.equal(evaluateTriggerFilter({ scope: "personal" }, userCtx), true);
});

test("installationIds allowlist gates regardless of scope", () => {
  assert.equal(
    evaluateTriggerFilter({ scope: "all", installationIds: [1001] }, orgCtx),
    true
  );
  assert.equal(
    evaluateTriggerFilter({ scope: "all", installationIds: [9999] }, orgCtx),
    false
  );
});

test("empty installationIds array does not filter", () => {
  assert.equal(
    evaluateTriggerFilter({ scope: "all", installationIds: [] }, orgCtx),
    true
  );
});

test("repos allowlist gates by full name", () => {
  assert.equal(
    evaluateTriggerFilter({ scope: "all", repos: ["acme/web"] }, orgCtx),
    true
  );
  assert.equal(
    evaluateTriggerFilter({ scope: "all", repos: ["acme/api"] }, orgCtx),
    false
  );
});

test("repos allowlist rejects null repoFullName", () => {
  assert.equal(
    evaluateTriggerFilter(
      { scope: "all", repos: ["acme/web"] },
      { ...orgCtx, repoFullName: null }
    ),
    false
  );
});

test("repos allowlist matches case-insensitively and ignores surrounding whitespace", () => {
  assert.equal(
    evaluateTriggerFilter(
      { scope: "all", repos: ["Acme/Web"] },
      { ...orgCtx, repoFullName: "acme/web" }
    ),
    true
  );
  assert.equal(
    evaluateTriggerFilter(
      { scope: "all", repos: [" acme/web "] },
      { ...orgCtx, repoFullName: "ACME/WEB" }
    ),
    true
  );
});

test("scope and installationIds compose with AND", () => {
  assert.equal(
    evaluateTriggerFilter({ scope: "org", installationIds: [1001] }, orgCtx),
    true
  );
  assert.equal(
    evaluateTriggerFilter({ scope: "org", installationIds: [1001] }, userCtx),
    false
  );
  assert.equal(
    evaluateTriggerFilter({ scope: "org", installationIds: [9999] }, orgCtx),
    false
  );
});

test("scope, installationIds, and repos all compose with AND", () => {
  const filter = {
    scope: "org" as const,
    installationIds: [1001],
    repos: ["acme/web"],
  };
  assert.equal(evaluateTriggerFilter(filter, orgCtx), true);
  assert.equal(
    evaluateTriggerFilter(filter, { ...orgCtx, repoFullName: "acme/api" }),
    false
  );
});

const dependabotCtx: TriggerFilterContext = {
  ...orgCtx,
  authorLogin: "dependabot[bot]",
  authorIsBot: true,
};

const humanCtx: TriggerFilterContext = {
  ...orgCtx,
  authorLogin: "octocat",
  authorIsBot: false,
};

const otherBotCtx: TriggerFilterContext = {
  ...orgCtx,
  authorLogin: "renovate[bot]",
  authorIsBot: true,
};

test("authorFilter=any matches every author", () => {
  const filter = { scope: "all" as const, authorFilter: "any" as const };
  assert.equal(evaluateTriggerFilter(filter, dependabotCtx), true);
  assert.equal(evaluateTriggerFilter(filter, humanCtx), true);
  assert.equal(evaluateTriggerFilter(filter, orgCtx), true);
});

test("authorFilter=humans_only rejects bot authors", () => {
  const filter = {
    scope: "all" as const,
    authorFilter: "humans_only" as const,
  };
  assert.equal(evaluateTriggerFilter(filter, humanCtx), true);
  assert.equal(evaluateTriggerFilter(filter, dependabotCtx), false);
  assert.equal(evaluateTriggerFilter(filter, otherBotCtx), false);
});

test("authorFilter=humans_only allows events without author context", () => {
  const filter = {
    scope: "all" as const,
    authorFilter: "humans_only" as const,
  };
  assert.equal(evaluateTriggerFilter(filter, orgCtx), true);
});

test("authorFilter=exclude_dependabot rejects only dependabot", () => {
  const filter = {
    scope: "all" as const,
    authorFilter: "exclude_dependabot" as const,
  };
  assert.equal(evaluateTriggerFilter(filter, dependabotCtx), false);
  assert.equal(evaluateTriggerFilter(filter, otherBotCtx), true);
  assert.equal(evaluateTriggerFilter(filter, humanCtx), true);
  assert.equal(evaluateTriggerFilter(filter, orgCtx), true);
});

test("authorFilter=dependabot_only matches only dependabot logins", () => {
  const filter = {
    scope: "all" as const,
    authorFilter: "dependabot_only" as const,
  };
  assert.equal(evaluateTriggerFilter(filter, dependabotCtx), true);
  assert.equal(
    evaluateTriggerFilter(filter, {
      ...orgCtx,
      authorLogin: "dependabot-preview[bot]",
      authorIsBot: true,
    }),
    true
  );
  assert.equal(evaluateTriggerFilter(filter, humanCtx), false);
  assert.equal(evaluateTriggerFilter(filter, otherBotCtx), false);
});

test("authorFilter=dependabot_only fails closed without author context", () => {
  const filter = {
    scope: "all" as const,
    authorFilter: "dependabot_only" as const,
  };
  assert.equal(evaluateTriggerFilter(filter, orgCtx), false);
});

test("authorFilter=dependabot_only rejects spoofed dependabot-prefixed logins", () => {
  const filter = {
    scope: "all" as const,
    authorFilter: "dependabot_only" as const,
  };
  const spoofedUserCtx: TriggerFilterContext = {
    ...orgCtx,
    authorLogin: "dependabot-helper",
    authorIsBot: false,
  };
  const spoofedBotCtx: TriggerFilterContext = {
    ...orgCtx,
    authorLogin: "dependabot-clone[bot]",
    authorIsBot: true,
  };
  assert.equal(evaluateTriggerFilter(filter, spoofedUserCtx), false);
  assert.equal(evaluateTriggerFilter(filter, spoofedBotCtx), false);
});

test("authorFilter=exclude_dependabot does not exclude dependabot-prefixed humans", () => {
  const filter = {
    scope: "all" as const,
    authorFilter: "exclude_dependabot" as const,
  };
  assert.equal(
    evaluateTriggerFilter(filter, {
      ...orgCtx,
      authorLogin: "dependabot-helper",
      authorIsBot: false,
    }),
    true
  );
});

test("normalizeAccountType maps the canonical webhook strings", () => {
  assert.equal(normalizeAccountType("User"), "User");
  assert.equal(normalizeAccountType("Organization"), "Organization");
});

test("normalizeAccountType is case- and whitespace-insensitive", () => {
  assert.equal(normalizeAccountType("  ORGANIZATION  "), "Organization");
  assert.equal(normalizeAccountType("organization"), "Organization");
  assert.equal(normalizeAccountType("user"), "User");
});

test("normalizeAccountType defaults missing or unknown values to User", () => {
  assert.equal(normalizeAccountType(null), "User");
  assert.equal(normalizeAccountType(undefined), "User");
  assert.equal(normalizeAccountType(""), "User");
  assert.equal(normalizeAccountType("Bot"), "User");
  assert.equal(normalizeAccountType("Mannequin"), "User");
});
