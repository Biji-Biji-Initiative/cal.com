// SPDX-License-Identifier: MIT
import { createHash, timingSafeEqual } from "node:crypto";

// An absent configuration is not the literal credential "undefined". Compare
// fixed-size digests without logging the configured or presented credential.
export function isTaskCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !secret.trim() || !header || header.length > 8192) return false;
  return timingSafeEqual(
    createHash("sha256").update(header).digest(),
    createHash("sha256").update(`Bearer ${secret}`).digest()
  );
}
