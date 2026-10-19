import process from "node:process";
import { readAuthentikConfig } from "@calcom/features/community-enterprise/identity/AuthentikConfig";
import { onboardingReturnPath } from "@calcom/features/onboarding/lib/onboarding-return-path";
import { WEBAPP_URL } from "@calcom/lib/constants";
import type { PageProps as ServerPageProps } from "app/_types";
import MerekaEntry from "~/auth/mereka-view";

export const dynamic = "force-dynamic";

export default async function ServerPage({ searchParams }: ServerPageProps) {
  let issuerOrigin: string;
  let appOrigin: string;
  try {
    const config = readAuthentikConfig(process.env);
    if (!config) return <MerekaEntry state="unavailable" />;
    issuerOrigin = new URL(config.issuer).origin;
    appOrigin = new URL(WEBAPP_URL).origin;
  } catch {
    return <MerekaEntry state="unavailable" />;
  }
  const { rd } = await searchParams;
  let returnPath = "/event-types";
  if (rd !== undefined) {
    if (typeof rd !== "string" || !rd || rd.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(rd)) {
      return <MerekaEntry state="invalid-callback" />;
    }
    try {
      if (rd.startsWith("//")) throw new Error("Invalid return address");
      const url = rd.startsWith("/") ? new URL(rd, appOrigin) : new URL(rd);
      if (url.origin !== appOrigin || url.username || url.password) throw new Error("Invalid return origin");
      returnPath = `${url.pathname}${url.search}${url.hash}`;
      // The existing helper falls back silently. An explicit entry must reject a
      // rejected destination rather than initiating a different sign-in request.
      if (
        /[\\\u0000-\u0020\u007f]/.test(decodeURIComponent(url.pathname)) ||
        onboardingReturnPath(returnPath) !== returnPath
      ) {
        throw new Error("Invalid return path");
      }
    } catch {
      return <MerekaEntry state="invalid-callback" />;
    }
  }
  return (
    <MerekaEntry
      state="ready"
      callbackUrl={new URL(returnPath, appOrigin).href}
      issuerOrigin={issuerOrigin}
    />
  );
}
