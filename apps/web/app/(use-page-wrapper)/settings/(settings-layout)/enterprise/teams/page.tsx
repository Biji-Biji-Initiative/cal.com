import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import EnterpriseTeamsView from "~/settings/enterprise/teams-view";

export default async function Page() {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session) redirect("/auth/login?callbackUrl=/settings/enterprise/teams");
  return <EnterpriseTeamsView />;
}
