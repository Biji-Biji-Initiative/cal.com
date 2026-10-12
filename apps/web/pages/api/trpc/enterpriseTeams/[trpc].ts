import { createNextApiHandler } from "@calcom/trpc/server/createNextApiHandler";
import { enterpriseTeamsRouter } from "@calcom/trpc/server/routers/viewer/enterpriseTeams/_router";

export default createNextApiHandler(enterpriseTeamsRouter);
