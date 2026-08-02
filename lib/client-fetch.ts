"use client";

export class ClientFetchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly reason: "http" | "invalid_response" = "http"
  ) {
    super(message);
    this.name = "ClientFetchError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveErrorMessage(data: unknown, fallback: string) {
  if (isRecord(data) && typeof data.error === "string" && data.error.trim()) {
    return data.error.trim();
  }

  return fallback;
}

export async function fetchJsonArray<T>(
  url: string,
  fallbackMessage = "Failed to load data",
  init?: RequestInit
): Promise<T[]> {
  const response = await fetch(url, init);
  const data = await readJson(response);

  if (!response.ok) {
    throw new ClientFetchError(
      resolveErrorMessage(data, fallbackMessage),
      response.status
    );
  }

  if (!Array.isArray(data)) {
    throw new ClientFetchError(
      `Invalid array response for ${url}`,
      null,
      "invalid_response"
    );
  }

  return data as T[];
}

export async function fetchJsonObject<T extends Record<string, unknown>>(
  url: string,
  fallbackMessage = "Failed to load data",
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  const data = await readJson(response);

  if (!response.ok) {
    throw new ClientFetchError(
      resolveErrorMessage(data, fallbackMessage),
      response.status
    );
  }

  if (!isRecord(data)) {
    throw new ClientFetchError(
      `Invalid object response for ${url}`,
      null,
      "invalid_response"
    );
  }

  return data as T;
}
