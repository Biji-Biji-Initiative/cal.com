import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { listApiKeyMetadata } from "@calcom/features/community-enterprise/api-keys/ApiKeyManagement";
import { APP_NAME } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import ApiKeysView from "~/settings/developer/api-keys-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("api_keys"),
    (t) => t("create_first_api_key_description", { appName: APP_NAME }),
    undefined,
    undefined,
    "/settings/developer/api-keys"
  );

const Page = async () => {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });

  if (!session) {
    redirect("/auth/login?callbackUrl=/settings/developer/api-keys");
  }

  const userId = session.user.id;
  const apiKeys = await listApiKeyMetadata(prisma, userId);

  return <ApiKeysView apiKeys={apiKeys} />;
};

export default Page;
