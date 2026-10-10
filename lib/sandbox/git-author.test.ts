import { expect, it } from "vitest";
import { normalizeGithubUserId, sandboxGitAuthorEnv } from "./git-author";

it("accepts both PostgreSQL bigint strings and GitHub numeric IDs without rounding", () => {
  expect(normalizeGithubUserId("123456789")).toBe("123456789");
  expect(normalizeGithubUserId(123456789)).toBe("123456789");
  for (const value of [
    null,
    undefined,
    "",
    "12.3",
    "-1",
    "1e3",
    "0",
    0,
    -1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(normalizeGithubUserId(value)).toBeNull();
  }
});

it("pins author and committer to the acting GitHub user", () => {
  expect(
    sandboxGitAuthorEnv({
      name: "User",
      email: "123+user@users.noreply.github.com",
    })
  ).toEqual({
    GIT_AUTHOR_NAME: "User",
    GIT_AUTHOR_EMAIL: "123+user@users.noreply.github.com",
    GIT_COMMITTER_NAME: "User",
    GIT_COMMITTER_EMAIL: "123+user@users.noreply.github.com",
  });
});
