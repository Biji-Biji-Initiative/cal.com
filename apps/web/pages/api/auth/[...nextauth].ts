import process from "node:process";
import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth from "next-auth";

import { getOptions } from "@calcom/features/auth/lib/next-auth-options";
import {
  isAuthentikOnly,
  restrictStaffJwt,
  restrictStaffSignIn,
  selectAuthentikProvider,
} from "@calcom/features/community-enterprise/identity/StaffLoginPolicy";
import { getTrackingFromCookies } from "@calcom/lib/tracking";

// pass req to NextAuth: https://github.com/nextauthjs/next-auth/discussions/469
const handler = (req: NextApiRequest, res: NextApiResponse) => {
  const onlyAuthentik = isAuthentikOnly(process.env);
  const options = getOptions({
    getDubId: () => req.cookies.dub_id || req.cookies.dclid,
    getTrackingData: () => getTrackingFromCookies(req.cookies, req.query),
  });
  if (!onlyAuthentik) return NextAuth(req, res, options);

  const callbacks = options.callbacks;
  if (!callbacks?.signIn || !callbacks.jwt) throw new Error("Native identity callbacks are required");
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
