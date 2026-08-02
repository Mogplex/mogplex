import {
  defaultSandboxAuth,
  defaultSandboxBaseRecord,
  defaultSandboxDetailRecord,
  defaultSandboxRestartRecord,
  type SandboxBaseRecordFixture,
  type SandboxDetailRecordFixture,
  type SandboxRestartRecordFixture,
} from "./shared";

export function buildLoadedSandboxDetailRecord(
  overrides: Partial<SandboxDetailRecordFixture> = {}
) {
  return {
    ok: true as const,
    auth: { ...defaultSandboxAuth },
    repo: null,
    rootDirectory: undefined,
    record: {
      ...defaultSandboxDetailRecord,
      ...overrides,
    },
  };
}

export function buildLoadedSandboxDeleteRecord(
  overrides: Partial<SandboxBaseRecordFixture> = {}
) {
  return {
    ok: true as const,
    auth: { ...defaultSandboxAuth },
    repo: null,
    rootDirectory: undefined,
    record: {
      ...defaultSandboxBaseRecord,
      ...overrides,
    },
  };
}

export function buildLoadedSandboxStopRecord(
  overrides: Partial<SandboxDetailRecordFixture> = {}
) {
  return buildLoadedSandboxDetailRecord(overrides);
}

export function buildLoadedSandboxRestartRecord(
  overrides: Partial<SandboxRestartRecordFixture> = {}
) {
  return {
    ok: true as const,
    auth: { ...defaultSandboxAuth },
    repo: null,
    rootDirectory: undefined,
    record: {
      ...defaultSandboxRestartRecord,
      ...overrides,
    },
  };
}
