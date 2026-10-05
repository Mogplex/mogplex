import type { RecordTeamAuditEventInput } from "@/lib/team-audit";
import {
  createTestGithubAppPrivateKey,
  loadToolsModule,
  parseJsonRequestBody,
  withEnv,
  withPatchedFetch,
  withPatchedGithubInstallations,
} from "./agents-tools-fixtures";

const GITHUB_APP_ENV = {
  GITHUB_APP_ID: "12345",
  GITHUB_APP_NAME: "mogplex-test",
  GITHUB_APP_PRIVATE_KEY: createTestGithubAppPrivateKey(),
};

/** `null` logins makes the installation lookup itself fail. */
export async function withInstallations(
  logins: string[] | null,
  callback: () => Promise<void>
) {
  await withEnv(GITHUB_APP_ENV, async () => {
    await withPatchedGithubInstallations(
      logins
        ? {
            data: logins.map((login) => ({
              installation_id: 321,
              account_login: login,
            })),
            error: null,
          }
        : { data: null, error: { message: "database unavailable" } },
      callback
    );
  });
}

export const withAcmeInstallation = (callback: () => Promise<void>) =>
  withInstallations(["acme"], callback);

export type MergeFetchCall = { method: string; path: string; body?: unknown };

export const REVIEWED_HEAD_SHA = "4928f94e852191d761352294ae1eabfa34b7d0ab";

type MergeStubState = {
  status?: number;
  mergeableState?: string;
  /** The PR author; defaults to the Mogplex app bot ("mogplex-test"). */
  author?: { __typename: "Bot" | "User"; login: string };
  reviewDecision?: string | null;
  ownershipStatus?: number;
  /** Approvals an active ruleset on `main` requires; none by default. */
  rulesetReviewCount?: number;
};

function pullResponse(pull: MergeStubState) {
  if (pull.status) return new Response("boom", { status: pull.status });
  return Response.json({
    state: "open",
    draft: false,
    mergeable: true,
    mergeable_state: pull.mergeableState ?? "clean",
    node_id: "PR_84",
    head: { sha: REVIEWED_HEAD_SHA },
  });
}

function ownershipResponse(pull: MergeStubState) {
  if (pull.ownershipStatus) {
    return new Response("boom", { status: pull.ownershipStatus });
  }
  return Response.json({
    data: {
      repository: {
        pullRequest: {
          url: "https://github.com/acme/widgets/pull/84",
          reviewDecision: pull.reviewDecision ?? null,
          baseRefName: "main",
          author: pull.author ?? { __typename: "Bot", login: "mogplex-test" },
        },
      },
    },
  });
}

function graphqlResponse(pull: MergeStubState, body: unknown) {
  const query = (body as { query?: string } | undefined)?.query ?? "";
  if (query.includes("PullRequestOwnership")) return ownershipResponse(pull);
  return Response.json({
    data: {
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: "2026-09-30" } },
      },
    },
  });
}

/** GitHub stub for acme/widgets#84 in a given merge state. */
export function mergeFetch(calls: MergeFetchCall[], pull: MergeStubState = {}) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const { pathname } = new URL(String(url));
    const body = parseJsonRequestBody(init?.body);
    calls.push({ method: init?.method ?? "GET", path: pathname, body });
    if (pathname === "/app/installations/321/access_tokens") {
      return Response.json({ token: "ghs-installation" });
    }
    if (pathname === "/repos/acme/widgets/pulls/84") return pullResponse(pull);
    if (pathname === "/graphql") return graphqlResponse(pull, body);
    if (pathname === "/repos/acme/widgets/rules/branches/main") {
      return Response.json(
        pull.rulesetReviewCount
          ? [
              {
                type: "pull_request",
                parameters: {
                  required_approving_review_count: pull.rulesetReviewCount,
                },
              },
            ]
          : []
      );
    }
    return Response.json({
      merged: true,
      sha: "6a6add1716c3fd2dc8ca76600638b445df6a7a07",
    });
  };
}

export type MergeExecute = (input: {
  owner: string;
  repo: string;
  number: number;
  expectedHeadSha: string;
}) => Promise<unknown>;

/** Runs one team-scoped merge and returns the audit events it recorded. */
export async function auditedTeamMerge(
  fetchImpl: ReturnType<typeof mergeFetch>,
  installedLogins: string[] | null = ["acme"],
  input: {
    owner?: string;
    contextRepo?: string;
    userGithubLogin?: string | null;
    onResult?: (result: unknown) => void;
  } = {}
) {
  const events: RecordTeamAuditEventInput[] = [];
  await withInstallations(installedLogins, async () => {
    await withPatchedFetch(fetchImpl, async () => {
      const { createGithubPullRequestMergeTool } = await loadToolsModule();
      const tool = createGithubPullRequestMergeTool({
        userId: "user-1",
        teamId: "team-1",
        aiCallId: "call-1",
        contextRepo: {
          id: "repo-1",
          owner: "acme",
          repo: input.contextRepo ?? "widgets",
        },
        requestId: "slack:T1:Ev1",
        mergePolicyDeps: {
          read: async () => ({
            requireApproval: false,
            contextRepoOnly: false,
          }),
          claimApproval: async () => null,
          requestApproval: async () => {
            throw new Error("Approval is off in this fixture");
          },
        },
        loadUserGithubLogin: async () => input.userGithubLogin ?? null,
        recordAuditEvent: async (event) => {
          events.push(event);
          return { ok: true };
        },
      }) as unknown as { execute: MergeExecute };
      const result = await tool.execute({
        owner: input.owner ?? "acme",
        repo: "widgets",
        number: 84,
        expectedHeadSha: REVIEWED_HEAD_SHA,
      });
      input.onResult?.(result);
    });
  });
  return events;
}

export function mergeAuditEvent(
  decisionCode: string,
  extra: { error?: string; repoId?: string | null; basis?: string } = {}
) {
  const { error, repoId = "repo-1", basis } = extra;
  return {
    productTeamId: "team-1",
    actorUserId: "user-1",
    action: "github.pull_request.merge",
    decisionCode,
    targetType: "github_pull_request",
    targetId: "acme/widgets#84",
    correlations: {
      aiCallId: "call-1",
      repoId,
      requestId: "slack:T1:Ev1",
    },
    payload: {
      target_owner: "acme",
      target_repo: "widgets",
      head_sha: REVIEWED_HEAD_SHA,
      ...(basis ? { author_basis: basis } : {}),
      ...(error ? { error } : {}),
    },
  };
}
