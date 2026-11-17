import {
  createCommitSigningRouteHandlers,
  type CommitSigningRouteDeps,
} from "../../app/api/settings/commit-signing/route";

type StoredKey = {
  publicKey: string;
  fingerprint: string;
  title: string | null;
  githubKeyId: string | null;
  registeredAt: string | null;
  createdAt: string;
};

export function commitSigningFixture(
  overrides: Partial<CommitSigningRouteDeps> = {}
) {
  let stored: StoredKey | null = null;
  const saved: { privateKey: string; publicKey: string }[] = [];
  const deleted: string[] = [];
  const registrations: { publicKey: string; title: string }[] = [];

  const handlers = createCommitSigningRouteHandlers({
    requireUserId: async () => "user-1",
    isEncryptionConfigured: () => true,
    loadKey: async () => stored,
    saveKey: async (input: { privateKey: string; publicKey: string }) => {
      saved.push({ privateKey: input.privateKey, publicKey: input.publicKey });
      stored = {
        publicKey: input.publicKey,
        fingerprint: "SHA256:test",
        title: null,
        githubKeyId: null,
        registeredAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      return stored;
    },
    deleteKey: async (userId: string) => {
      deleted.push(userId);
      stored = null;
    },
    markRegistered: async (input: {
      githubKeyId: string | null;
      publicKey: string;
    }) => {
      if (stored?.publicKey === input.publicKey) {
        stored = {
          ...stored,
          githubKeyId: input.githubKeyId,
          registeredAt: "2026-01-02T00:00:00.000Z",
        };
      }
    },
    getGithubToken: async () => "gh-token",
    checkKey: async () => ({ status: "not_registered" }),
    clearRegistration: async (input: { publicKey: string }) => {
      if (stored?.publicKey === input.publicKey)
        stored = { ...stored, registeredAt: null, githubKeyId: null };
    },
    registerKey: async (input: { publicKey: string; title: string }) => {
      registrations.push(input);
      return { status: "registered", keyId: "99" };
    },
    ...overrides,
  });

  return { handlers, saved, deleted, registrations, current: () => stored };
}
