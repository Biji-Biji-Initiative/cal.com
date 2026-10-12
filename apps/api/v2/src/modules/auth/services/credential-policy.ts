// SPDX-License-Identifier: MIT
export function sessionUserId(token: { sub?: unknown }): number {
  if (typeof token.sub !== "string" || !/^[1-9][0-9]*$/.test(token.sub)) {
    throw new Error("Invalid session subject");
  }
  const id = Number(token.sub);
  if (!Number.isSafeInteger(id)) throw new Error("Invalid session subject");
  return id;
}

export function parseBearerHeader(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  // A supplied malformed credential cannot silently fall back to a cookie.
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(value);
  if (!match) throw new Error("Invalid Authorization header");
  return match[1];
}

export function isUsableApiKeyExpiry(value: unknown, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  if (value === null) return true;
  return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() > now;
}
