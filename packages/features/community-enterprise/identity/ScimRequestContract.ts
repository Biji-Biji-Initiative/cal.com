// SPDX-License-Identifier: MIT

/**
 * Transport boundary for the eventual SCIM adapter.
 *
 * Authentication and route parsing stay separate from directory reconciliation:
 * the caller must supply a bearer credential, and credentials in query strings
 * are never accepted. This module does not validate or persist the credential.
 */

export type ScimResource = "Users" | "Groups";
export type ScimRequestMethod = "GET" | "PUT" | "PATCH";

export interface ScimAuthorization {
  scheme: "Bearer";
  credential: string;
}

export interface ScimRequest {
  method: ScimRequestMethod;
  resource: ScimResource;
  resourceId: string | null;
  authorization: ScimAuthorization;
}

const SCIM_ROOT = "/scim/v2";

function requiredText(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim()) {
    throw new Error(`SCIM ${label} must be a non-empty, trimmed string`);
  }
  return value;
}

/** Parse an Authorization header without accepting credentials from a URL. */
export function parseScimAuthorization(value: unknown): ScimAuthorization {
  const header = requiredText(value, "authorization header");
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(header);
  if (!match) throw new Error("SCIM authorization must use the Bearer scheme");
  const credential = requiredText(match[1], "bearer credential");
  if (credential.length < 16) throw new Error("SCIM bearer credential is too short");
  return { scheme: "Bearer", credential };
}

/**
 * Parse only the stable SCIM resource routes. The adapter still owns token
 * verification, discovery, persistence and current authorization checks.
 */
export function parseScimRequest(input: {
  method: unknown;
  path: unknown;
  authorization: unknown;
  query?: Record<string, unknown>;
}): ScimRequest {
  const method = requiredText(input.method, "method").toUpperCase();
  if (method !== "GET" && method !== "PUT" && method !== "PATCH") {
    throw new Error("SCIM method is not supported");
  }
  const path = requiredText(input.path, "path");
  if (!path.startsWith(`${SCIM_ROOT}/`) || path.includes("?") || path.includes("#")) {
    throw new Error("SCIM path is outside the versioned resource boundary");
  }
  const parts = path.slice(`${SCIM_ROOT}/`.length).split("/");
  if (parts.length < 1 || parts.length > 2 || (parts[0] !== "Users" && parts[0] !== "Groups")) {
    throw new Error("SCIM path must target Users or Groups");
  }
  if (parts.length === 2) requiredText(parts[1], "resource id", 256);
  if (input.query && Object.keys(input.query).some((key) => /token|credential|authorization/i.test(key))) {
    throw new Error("SCIM credentials must not be supplied in query parameters");
  }
  const resource = parts[0] as ScimResource;
  if (resource === "Users" && method === "PATCH") throw new Error("SCIM user PATCH is not supported");
  if (resource === "Groups" && method === "PUT") throw new Error("SCIM group PUT is not supported");
  return {
    method: method as ScimRequestMethod,
    resource,
    resourceId: parts[1] ?? null,
    authorization: parseScimAuthorization(input.authorization),
  };
}
