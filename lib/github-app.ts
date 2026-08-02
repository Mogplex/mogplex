import crypto from "node:crypto";

export class GithubHttpError extends Error {
  status: number;
  responseBody: string;

  constructor(status: number, responseBody: string, message?: string) {
    super(message ?? `GitHub request failed (${status}): ${responseBody}`);
    this.name = "GithubHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export type GithubInstallation = {
  id: number;
  account?: {
    login?: string;
    type?: string;
  };
  target_type?: string;
  permissions?: Record<string, string>;
};

type GithubInstallationRepo = {
  id: number;
  full_name: string;
  default_branch?: string;
  owner?: {
    login?: string;
  };
  name?: string;
};

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/g, "");
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.includes(String.raw`\n`)
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;
}

export function hasGithubAppConfig() {
  return Boolean(
    process.env.GITHUB_APP_ID?.trim() &&
    process.env.GITHUB_APP_PRIVATE_KEY?.trim() &&
    process.env.GITHUB_APP_NAME?.trim()
  );
}

function requireGithubAppEnv(
  name: "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY" | "GITHUB_APP_NAME"
) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function getGithubAppInstallUrl() {
  const appName = requireGithubAppEnv("GITHUB_APP_NAME");
  return `https://github.com/apps/${appName}/installations/new`;
}

export function createGithubAppJwt() {
  const appId = requireGithubAppEnv("GITHUB_APP_ID");
  const privateKey = normalizePrivateKey(
    requireGithubAppEnv("GITHUB_APP_PRIVATE_KEY")
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: appId,
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(privateKey);

  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function githubAppFetch<T>(url: string, init?: RequestInit) {
  const jwt = createGithubAppJwt();
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GithubHttpError(
      response.status,
      body,
      `GitHub App request failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<T>;
}

async function githubAppFetchNullable<T>(url: string, init?: RequestInit) {
  const jwt = createGithubAppJwt();
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new GithubHttpError(
      response.status,
      body,
      `GitHub App request failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<T>;
}

export async function githubInstallationFetch<T>(
  installationToken: string,
  url: string
) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${installationToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GithubHttpError(
      response.status,
      body,
      `GitHub installation request failed (${response.status}): ${body}`
    );
  }

  return response.json() as Promise<T>;
}

export async function getGithubInstallation(installationId: number) {
  return githubAppFetch<GithubInstallation>(
    `https://api.github.com/app/installations/${installationId}`
  );
}

export async function findGithubInstallationForAccount(account: string) {
  const normalized = account.trim();
  if (!normalized) return null;

  const orgInstallation = await githubAppFetchNullable<GithubInstallation>(
    `https://api.github.com/orgs/${encodeURIComponent(normalized)}/installation`
  );
  if (orgInstallation) return orgInstallation;

  return githubAppFetchNullable<GithubInstallation>(
    `https://api.github.com/users/${encodeURIComponent(normalized)}/installation`
  );
}

export async function createGithubInstallationAccessToken(
  installationId: number
) {
  return githubAppFetch<{ token: string }>(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
}

export async function fetchGithubInstallationRepos(installationId: number) {
  const { token } = await createGithubInstallationAccessToken(installationId);
  const repos: GithubInstallationRepo[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const data = await githubInstallationFetch<{
      repositories?: GithubInstallationRepo[];
    }>(
      token,
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`
    );
    const batch = data.repositories || [];
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  return repos;
}
