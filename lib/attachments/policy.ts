export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 4 * 1024 * 1024,
  maxDataUrlChars: 5_600_000,
  maxTotalBytes: 5 * 4 * 1024 * 1024,
} as const;
