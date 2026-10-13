// SPDX-License-Identifier: MIT
export interface ApiKeyInput {
  note?: string | null;
  expiresAt?: Date | null;
  neverExpires?: boolean;
  appId?: string | null;
  teamId?: number;
}

export function normalizeApiKeyInput(input: ApiKeyInput, now: number) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Number.isFinite(now)) {
    throw new Error("Invalid API key input");
  }
  if (input.neverExpires !== undefined && typeof input.neverExpires !== "boolean") {
    throw new Error("Invalid API key lifetime");
  }
  if (input.teamId !== undefined && (!Number.isSafeInteger(input.teamId) || input.teamId <= 0)) {
    throw new Error("Invalid API key team");
  }
  for (const field of ["note", "appId"] as const) {
    const value = input[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      throw new Error("Invalid API key metadata");
    }
  }
  const expiresAt = input.neverExpires === true ? null :
    input.expiresAt === undefined ? new Date(now + 30 * 86400000) : input.expiresAt;
  if (expiresAt !== null && (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now)) {
    throw new Error("API key expiration must be in the future");
  }
  if (expiresAt === null && input.neverExpires !== true) throw new Error("Non-expiring keys must be explicit");
  return { note: input.note ?? null, appId: input.appId ?? null, teamId: input.teamId ?? null,
    expiresAt: expiresAt === null ? null : new Date(expiresAt.getTime()) };
}

export function checkedApiKeyPrefix(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error("Invalid API key prefix configuration");
  }
  return value;
}

export function rawApiKey(value: string, prefix: string) {
  checkedApiKeyPrefix(prefix);
  if (typeof value !== "string" || !value.startsWith(prefix)) throw new Error("Invalid API key");
  const raw = value.slice(prefix.length);
  if (!/^[A-Za-z0-9._~+/=-]{16,512}$/.test(raw)) throw new Error("Invalid API key");
  return raw;
}
