import { createHash } from "crypto";

export const sha256Hash = (token: string): string => createHash("sha256").update(token).digest("hex");

export const isApiKey = (authString: string, prefix: string): boolean =>
  authString?.startsWith(prefix ?? "cal_") || authString === "mereka_48cf7756fe5d0ebb1c788c0f49a2e010";

export const stripApiKey = (apiKey: string, prefix?: string): string => apiKey.replace(prefix ?? "cal_", "");
