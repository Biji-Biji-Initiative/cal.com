// SPDX-License-Identifier: MIT

/**
 * Source-level contract for a preservation-first database restore rehearsal.
 *
 * This module is deliberately write-free. It validates the receipt produced by
 * an operator after restoring an authorized backup into a disposable database,
 * then compares the restored snapshot with the source snapshot. It accepts
 * fingerprints of encryption keys, never key material. The real backup,
 * quiesced writers, isolated database and application migration command remain
 * deployment responsibilities.
 */

export type RecoveryEntity = "users" | "profiles" | "bookings" | "eventTypes" | "providers";

export interface RecoverySnapshot {
  counts: Record<RecoveryEntity, number>;
  stableIds: Record<RecoveryEntity, readonly string[]>;
  bookingUrls: readonly string[];
  encryptionKeyFingerprint: string;
}

export interface RestoreReconciliationInput {
  scope: "isolated-disposable";
  productionTarget: false;
  writerQuiesced: true;
  backupId: string;
  backupCapturedAt: string;
  restoredAt: string;
  source: RecoverySnapshot;
  restored: RecoverySnapshot;
}

export type RestoreDifferenceCode =
  | "count-mismatch"
  | "stable-id-mismatch"
  | "booking-url-mismatch"
  | "encryption-fingerprint-mismatch";

export interface RestoreDifference {
  code: RestoreDifferenceCode;
  entity?: RecoveryEntity;
  expected: unknown;
  actual: unknown;
}

export interface RestoreReconciliationReport {
  version: 1;
  backupId: string;
  matched: boolean;
  differences: readonly RestoreDifference[];
  source: RecoverySnapshot;
  restored: RecoverySnapshot;
}

const ENTITY_ORDER: readonly RecoveryEntity[] = ["users", "profiles", "bookings", "eventTypes", "providers"];
const FINGERPRINT = /^[a-f0-9]{64}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty, trimmed string`);
  }
  return value;
}

function instant(value: unknown, label: string): string {
  const parsed = text(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return parsed;
}

function fingerprint(value: unknown, label: string): string {
  const parsed = text(value, label, 64).toLowerCase();
  if (!FINGERPRINT.test(parsed)) throw new Error(`${label} must be a SHA-256 fingerprint`);
  return parsed;
}

function stableIdList(value: unknown, entity: RecoveryEntity): string[] {
  if (!Array.isArray(value)) throw new Error(`${entity} stable IDs must be an array`);
  const ids = value.map((entry) => text(entry, `${entity} stable ID`, 512));
  if (new Set(ids).size !== ids.length) throw new Error(`${entity} stable IDs contain duplicates`);
  return [...ids].sort();
}

function counts(value: unknown): Record<RecoveryEntity, number> {
  const source = object(value, "snapshot counts");
  return Object.fromEntries(
    ENTITY_ORDER.map((entity) => {
      const count = source[entity];
      if (!Number.isSafeInteger(count) || (count as number) < 0) {
        throw new Error(`${entity} count must be a non-negative integer`);
      }
      return [entity, count];
    })
  ) as Record<RecoveryEntity, number>;
}

function bookingUrls(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("booking URLs must be an array");
  const urls = value.map((entry) => {
    const raw = text(entry, "booking URL", 2048);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("booking URL must be absolute");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("booking URL must use HTTP or HTTPS");
    }
    if (!parsed.hostname || parsed.username || parsed.password || parsed.hash) {
      throw new Error("booking URL cannot contain credentials or a fragment");
    }
    return parsed.toString();
  });
  if (new Set(urls).size !== urls.length) throw new Error("booking URLs contain duplicates");
  return [...urls].sort();
}

function snapshot(value: unknown, label: string): RecoverySnapshot {
  const source = object(value, label);
  const stableIds = object(source.stableIds, `${label} stableIds`);
  const normalizedCounts = counts(source.counts);
  const normalizedIds = Object.fromEntries(
    ENTITY_ORDER.map((entity) => [entity, stableIdList(stableIds[entity], entity)])
  ) as Record<RecoveryEntity, string[]>;
  for (const entity of ENTITY_ORDER) {
    if (normalizedCounts[entity] !== normalizedIds[entity].length) {
      throw new Error(`${label} ${entity} count does not match stable ID count`);
    }
  }
  return {
    counts: normalizedCounts,
    stableIds: normalizedIds,
    bookingUrls: bookingUrls(source.bookingUrls),
    encryptionKeyFingerprint: fingerprint(
      source.encryptionKeyFingerprint,
      `${label} encryptionKeyFingerprint`
    ),
  };
}

/** Validate and normalize a snapshot emitted by an isolated restore operator. */
export function parseRecoverySnapshot(value: unknown, label = "recovery snapshot"): RecoverySnapshot {
  return snapshot(value, label);
}

function difference(
  code: RestoreDifferenceCode,
  expected: unknown,
  actual: unknown,
  entity?: RecoveryEntity
): RestoreDifference {
  return entity ? { code, entity, expected, actual } : { code, expected, actual };
}

/**
 * Compare source and restored snapshots without touching either database. The
 * returned ordering is stable so an evidence receipt can be diffed and signed.
 */
export function reconcileRestoredSnapshot(input: RestoreReconciliationInput): RestoreReconciliationReport {
  if (input.scope !== "isolated-disposable") throw new Error("restore scope must be isolated-disposable");
  if (input.productionTarget !== false) throw new Error("restore target must not be production");
  if (input.writerQuiesced !== true) throw new Error("restore requires quiesced writers");
  const backupId = text(input.backupId, "backupId");
  const backupCapturedAt = instant(input.backupCapturedAt, "backupCapturedAt");
  const restoredAt = instant(input.restoredAt, "restoredAt");
  if (Date.parse(restoredAt) < Date.parse(backupCapturedAt)) {
    throw new Error("restore timestamp cannot precede backup capture");
  }
  const source = snapshot(input.source, "source snapshot");
  const restored = snapshot(input.restored, "restored snapshot");
  const differences: RestoreDifference[] = [];

  for (const entity of ENTITY_ORDER) {
    if (source.counts[entity] !== restored.counts[entity]) {
      differences.push(difference("count-mismatch", source.counts[entity], restored.counts[entity], entity));
    }
    if (JSON.stringify(source.stableIds[entity]) !== JSON.stringify(restored.stableIds[entity])) {
      differences.push(
        difference("stable-id-mismatch", source.stableIds[entity], restored.stableIds[entity], entity)
      );
    }
  }
  if (JSON.stringify(source.bookingUrls) !== JSON.stringify(restored.bookingUrls)) {
    differences.push(difference("booking-url-mismatch", source.bookingUrls, restored.bookingUrls));
  }
  if (source.encryptionKeyFingerprint !== restored.encryptionKeyFingerprint) {
    differences.push(
      difference(
        "encryption-fingerprint-mismatch",
        source.encryptionKeyFingerprint,
        restored.encryptionKeyFingerprint
      )
    );
  }

  return { version: 1, backupId, matched: differences.length === 0, differences, source, restored };
}
