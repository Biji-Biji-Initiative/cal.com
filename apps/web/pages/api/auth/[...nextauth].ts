import process from "node:process";
import { getOptions } from "@calcom/features/auth/lib/next-auth-options";
import {
  isAuthentikOnly,
  isBridgeStaffOnly,
  restrictBridgeJwt,
  restrictStaffJwt,
  restrictStaffSignIn,
  selectAuthentikProvider,
} from "@calcom/features/community-enterprise/identity/StaffLoginPolicy";
import { getTrackingFromCookies } from "@calcom/lib/tracking";
import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth from "next-auth";

// pass req to NextAuth: https://github.com/nextauthjs/next-auth/discussions/469
const handler = (req: NextApiRequest, res: NextApiResponse) => {
  const onlyAuthentik = isAuthentikOnly(process.env);
  const bridgeOnly = isBridgeStaffOnly(process.env);
  const options = getOptions({
    getDubId: () => req.cookies.dub_id || req.cookies.dclid,
    getTrackingData: () => getTrackingFromCookies(req.cookies, req.query),
  });
  if (!onlyAuthentik && !bridgeOnly) return NextAuth(req, res, options);

  const callbacks = options.callbacks;
  if (!callbacks?.signIn || !callbacks.jwt) throw new Error("Native identity callbacks are required");
  if (bridgeOnly) {
    return NextAuth(req, res, {
      ...options,
      providers: [],
      callbacks: {
        ...callbacks,
        signIn: async () => false,
        jwt: restrictBridgeJwt(callbacks.jwt),
      },
    });
  }
  return NextAuth(req, res, {
    ...options,
    providers: selectAuthentikProvider(options.providers),
    callbacks: {
      ...callbacks,
      signIn: restrictStaffSignIn(callbacks.signIn),
      jwt: restrictStaffJwt(callbacks.jwt),
    },
  });
};

export default handler;
