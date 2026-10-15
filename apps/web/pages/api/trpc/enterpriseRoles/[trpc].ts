import { createNextApiHandler } from "@calcom/trpc/server/createNextApiHandler";
import { enterpriseRolesRouter } from "@calcom/trpc/server/routers/viewer/enterpriseRoles/_router";

export default createNextApiHandler(enterpriseRolesRouter);
