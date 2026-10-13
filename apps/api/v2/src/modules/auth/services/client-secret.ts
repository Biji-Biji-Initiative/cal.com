// SPDX-License-Identifier: MIT
import { createHash, timingSafeEqual } from "node:crypto";

export function clientSecretsMatch(expected: unknown, supplied: unknown): boolean {
  if (typeof expected !== "string" || typeof supplied !== "string" || !expected || !supplied) {
    return false;
  }
  // Fixed-size digests support timingSafeEqual even when input lengths differ.
  // UTF-16 code units preserve exact JS string equality without lossy replacement
  // of unpaired surrogates. This changes neither storage nor credential format.
  const digest = (value: string) => createHash("sha256").update(value, "utf16le").digest();
  return timingSafeEqual(digest(expected), digest(supplied));
}
