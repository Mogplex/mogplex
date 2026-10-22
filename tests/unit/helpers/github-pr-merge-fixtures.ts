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
  author?: { __typename: "Bot" | "User"; login: string } | null;
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
    user:
      pull.author === null
        ? null
        : {
            type: pull.author?.__typename ?? "Bot",
            login: pull.author?.login ?? "mogplex-test",
          },
  });
}

function graphqlResponse() {
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
    if (pathname === "/graphql") return graphqlResponse();
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
        },
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
  extra: {
    error?: string;
    repoId?: string | null;
    authorLogin?: string | null;
  } = {}
) {
  const { error, repoId = "repo-1", authorLogin } = extra;
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
      ...(authorLogin === undefined ? {} : { author_login: authorLogin }),
      ...(error ? { error } : {}),
    },
  };
}
