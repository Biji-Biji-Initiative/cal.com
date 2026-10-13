// SPDX-License-Identifier: MIT
const FALLBACK = "/event-types";

// Signup hints are browser state, not authority. Preserve local app/invitation
// destinations without reviving removed checkout/onboarding paths or schemes.
export function onboardingReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/")) return FALLBACK;
  if (value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return FALLBACK;
  try {
    const base = "https://onboarding.invalid";
    const url = new URL(value, base);
    if (url.origin !== base || url.username || url.password) return FALLBACK;
    const pathname = decodeURIComponent(url.pathname);
    if (/[\\%]/.test(pathname)) return FALLBACK;
    const roots = ["/event-types", "/teams", "/bookings", "/availability", "/apps", "/settings"];
    if (!roots.some((root) => pathname === root || pathname.startsWith(`${root}/`))) return FALLBACK;
    if (/(^|\/)(billing|checkout|pricing|upgrade)(\/|$)/i.test(pathname)) return FALLBACK;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK;
  }
}
