// SPDX-License-Identifier: MIT

/**
 * Source-level SCIM boundary for the retained DSyncData/Team membership model.
 *
 * This module intentionally produces validated values and a reconciliation plan;
 * it does not make Prisma writes, issue bearer tokens, or call an IdP. The
 * eventual adapter must execute this plan inside the existing domain
 * transactions and re-check current authorization before each write.
 */

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PAGE_LIMIT = 100;

type RecordLike = Record<string, unknown>;

function record(value: unknown, label: string): RecordLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`SCIM ${label} must be an object`);
  }
  return value as RecordLike;
}

function requiredText(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw new Error(`SCIM ${label} must be a non-empty, trimmed string`);
  }
  return value;
}

function schemas(value: unknown, required: string, label: string): void {
  if (!Array.isArray(value) || !value.every((schema) => typeof schema === "string")) {
    throw new Error(`SCIM ${label}.schemas must be a string array`);
  }
  if (!value.includes(required)) throw new Error(`SCIM ${label} requires ${required}`);
}

function uniqueText(values: readonly string[], label: string): string[] {
  const normalized = values.map((value) => requiredText(value, label));
  if (new Set(normalized).size !== normalized.length) throw new Error(`SCIM ${label} contains duplicates`);
  return normalized;
}

export interface ScimUserResource {
  id: string;
  externalId: string;
  userName: string;
  active: boolean;
}

/**
 * `externalId` is the only directory-to-user key accepted by this contract.
 * Email, userName, displayName and mutable profile fields are never used as a
 * fallback. The value is returned byte-for-byte so an adapter cannot silently
 * normalize or remap a directory identity.
 */
export function parseScimUserResource(value: unknown): ScimUserResource {
  const resource = record(value, "user resource");
  schemas(resource.schemas, SCIM_USER_SCHEMA, "user resource");
  const active = resource.active === undefined ? true : resource.active;
  if (typeof active !== "boolean") throw new Error("SCIM user active must be boolean");
  return {
    id: requiredText(resource.id, "user id"),
    externalId: requiredText(resource.externalId, "user externalId"),
    userName: requiredText(resource.userName, "user userName"),
    active,
  };
}

export interface ScimGroupMember {
  value: string;
}

export interface ScimGroupPatchOperation {
  op: "add" | "remove";
  members: ScimGroupMember[];
}

/**
 * Only member add/remove operations are admitted. Group PATCH must not be used
 * as a disguised role or arbitrary-attribute write; the eventual adapter maps
 * these values to the retained DSyncTeamGroupMapping records.
 */
export function parseScimGroupPatch(value: unknown): ScimGroupPatchOperation[] {
  const patch = record(value, "group patch");
  schemas(patch.schemas, SCIM_PATCH_SCHEMA, "group patch");
  if (!Array.isArray(patch.Operations) || patch.Operations.length === 0) {
    throw new Error("SCIM group patch requires Operations");
  }
  return patch.Operations.map((rawOperation) => {
    const operation = record(rawOperation, "group patch operation");
    const op = typeof operation.op === "string" ? operation.op.toLowerCase() : "";
    if (op !== "add" && op !== "remove") throw new Error("SCIM group patch only supports add/remove");
    if (operation.path !== undefined && operation.path !== "members") {
      throw new Error("SCIM group patch only supports the members path");
    }
    const values = Array.isArray(operation.value) ? operation.value : [operation.value];
    if (values.length === 0) throw new Error("SCIM group patch requires at least one member");
    const members = values.map((rawMember) => {
      if (typeof rawMember === "string") return { value: requiredText(rawMember, "group member value") };
      const member = record(rawMember, "group member");
      return { value: requiredText(member.value, "group member value") };
    });
    uniqueText(
      members.map((member) => member.value),
      "group patch member values"
    );
    return { op, members } as ScimGroupPatchOperation;
  });
}

export interface ScimPage<T> {
  startIndex: number;
  itemsPerPage: number;
  totalResults: number;
  resources: T[];
}

/** Validate one bounded SCIM ListResponse and return the next 1-based cursor. */
export function parseScimPage<T>(value: unknown, map: (resource: unknown) => T): ScimPage<T> {
  const page = record(value, "list response");
  schemas(page.schemas, SCIM_LIST_SCHEMA, "list response");
  const startIndex = page.startIndex as number;
  const itemsPerPage = page.itemsPerPage as number;
  const totalResults = page.totalResults as number;
  if (
    !Number.isSafeInteger(startIndex) ||
    startIndex < 1 ||
    !Number.isSafeInteger(itemsPerPage) ||
    itemsPerPage < 0 ||
    itemsPerPage > SCIM_PAGE_LIMIT ||
    !Number.isSafeInteger(totalResults) ||
    totalResults < 0
  ) {
    throw new Error("SCIM list response has invalid paging metadata");
  }
  if (!Array.isArray(page.Resources) || page.Resources.length !== itemsPerPage) {
    throw new Error("SCIM list response item count does not match itemsPerPage");
  }
  if (startIndex > totalResults + 1 || startIndex + itemsPerPage > totalResults + 1) {
    throw new Error("SCIM list response exceeds totalResults");
  }
  return {
    startIndex,
    itemsPerPage,
    totalResults,
    resources: page.Resources.map(map),
  };
}

export function nextScimStart<T>(page: ScimPage<T>): number | null {
  if (page.itemsPerPage === 0) return null;
  const next = page.startIndex + page.itemsPerPage;
  return next > page.totalResults ? null : next;
}

export type ScimGrantSource = "local" | "scim";
export type ScimReconciliationEvent =
  | "group-sync"
  | "directory-filter-change"
  | "user-disable"
  | "user-deprovision";

export interface ExistingScimMembership {
  membershipId: number;
  externalId: string;
  source: ScimGrantSource;
  bookingCount: number;
}

export type ScimPlanOperation =
  | { type: "grant-scim-membership"; directoryId: string; externalId: string; source: "scim" }
  | {
      type: "remove-scim-membership";
      directoryId: string;
      externalId: string;
      membershipId: number;
      source: "scim";
    }
  | { type: "disable-new-assignment"; membershipId: number; externalId: string }
  | { type: "queue-reassignment"; membershipId: number; externalId: string; bookingCount: number };

export interface ScimReconciliationPlan {
  version: 1;
  directoryId: string;
  event: ScimReconciliationEvent;
  operations: ScimPlanOperation[];
  preserveLocalGrants: true;
  preserveBookingHistory: true;
  filterChangeRevokesNothing: true;
}

function membershipRows(rows: readonly ExistingScimMembership[]): ExistingScimMembership[] {
  const ids = rows.map((row) => row.membershipId);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid membership id");
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate membership id");
  const externalIds = rows.map((row) => row.externalId);
  rows.forEach((row) => {
    requiredText(row.externalId, "membership externalId");
    if (row.source !== "local" && row.source !== "scim") throw new Error("Invalid membership source");
    if (!Number.isSafeInteger(row.bookingCount) || row.bookingCount < 0)
      throw new Error("Invalid membership booking count");
  });
  if (new Set(externalIds).size !== externalIds.length) throw new Error("Duplicate membership externalId");
  return [...rows].sort((a, b) => a.membershipId - b.membershipId);
}

/**
 * Build an idempotent, write-free plan for the retained Membership model.
 * Local grants and booking history are never removed by this contract. A
 * directory filter change is informational only; only an explicit user
 * deprovision event may remove a SCIM-sourced grant.
 */
export function planScimMembershipReconciliation(input: {
  directoryId: string;
  event: ScimReconciliationEvent;
  current: readonly ExistingScimMembership[];
  desiredExternalIds?: readonly string[];
}): ScimReconciliationPlan {
  const directoryId = requiredText(input.directoryId, "directoryId");
  if (
    input.event !== "group-sync" &&
    input.event !== "directory-filter-change" &&
    input.event !== "user-disable" &&
    input.event !== "user-deprovision"
  ) {
    throw new Error("Invalid SCIM reconciliation event");
  }
  const current = membershipRows(input.current);
  const desired = uniqueText(input.desiredExternalIds ?? [], "desired externalId").sort();
  const currentIds = new Set(current.map((row) => row.externalId));
  const operations: ScimPlanOperation[] = [];

  if (input.event === "group-sync") {
    for (const externalId of desired) {
      if (!currentIds.has(externalId)) {
        operations.push({ type: "grant-scim-membership", directoryId, externalId, source: "scim" });
      }
    }
    for (const row of current) {
      if (row.source === "scim" && !desired.includes(row.externalId)) {
        operations.push({
          type: "remove-scim-membership",
          directoryId,
          externalId: row.externalId,
          membershipId: row.membershipId,
          source: "scim",
        });
      }
    }
  }

  if (input.event === "user-disable" || input.event === "user-deprovision") {
    for (const row of current) {
      operations.push({
        type: "disable-new-assignment",
        membershipId: row.membershipId,
        externalId: row.externalId,
      });
      if (row.bookingCount > 0) {
        operations.push({
          type: "queue-reassignment",
          membershipId: row.membershipId,
          externalId: row.externalId,
          bookingCount: row.bookingCount,
        });
      }
      if (input.event === "user-deprovision" && row.source === "scim") {
        operations.push({
          type: "remove-scim-membership",
          directoryId,
          externalId: row.externalId,
          membershipId: row.membershipId,
          source: "scim",
        });
      }
    }
  }

  return {
    version: 1,
    directoryId,
    event: input.event,
    operations,
    preserveLocalGrants: true,
    preserveBookingHistory: true,
    filterChangeRevokesNothing: true,
  };
}
