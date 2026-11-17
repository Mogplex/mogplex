import { expect, test } from "vitest";
import {
  generateCommitSigningKeyPair,
  readImportablePrivateKey,
} from "./key-material";

function mutateKey(
  change: (body: Buffer, outerKey: number, privateSection: number) => void
) {
  const pair = generateCommitSigningKeyPair();
  const body = Buffer.from(
    pair.privateKey.split("\n").slice(1, -2).join(""),
    "base64"
  );
  let offset = 15;
  for (let field = 0; field < 3; field++)
    offset += 4 + body.readUInt32BE(offset);
  offset += 4;
  const outerKey = offset + 4;
  offset += 4 + body.readUInt32BE(offset);
  change(body, outerKey, offset + 4);
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body.toString("base64")}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

test("rejects mismatched outer public keys, private seeds, and invalid padding", () => {
  const mutations = [
    (body: Buffer, outer: number) => {
      body[outer + 19] ^= 1;
    },
    (body: Buffer, _outer: number, inner: number) => {
      body[inner + 8 + 4 + 11 + 4 + 32 + 4] ^= 1;
    },
    (body: Buffer) => {
      body[body.length - 1] ^= 1;
    },
  ];
  for (const mutate of mutations)
    expect(() => readImportablePrivateKey(mutateKey(mutate))).toThrow();
});

test("canonicalizes a pasted armored block before storage", () => {
  const pair = generateCommitSigningKeyPair();
  expect(
    readImportablePrivateKey(`copied key:\n${pair.privateKey}end of paste`)
      .privateKey
  ).toBe(pair.privateKey);
});
