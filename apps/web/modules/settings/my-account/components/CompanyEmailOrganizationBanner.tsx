"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { useRouter } from "next/navigation";

type CompanyEmailOrganizationBannerProps = { onDismissAction: () => void };

// A corporate email is not an organization grant or a cloud subscription.
// The destination enforces existing membership and explicit operator admission.
export const CompanyEmailOrganizationBanner = ({ onDismissAction }: CompanyEmailOrganizationBannerProps) => {
  const { t } = useLocale();
  const router = useRouter();
  return (
    <div className="border-subtle mb-6 rounded-lg border p-4" data-testid="organization-access-banner">
      <h3 className="text-default text-sm font-semibold">{t("enterprise_organization_access_title")}</h3>
      <p className="text-default mt-1 text-sm">{t("enterprise_organization_access_description")}</p>
      <div className="mt-3 flex gap-2">
        <Button color="secondary" onClick={onDismissAction}>
          {t("dismiss")}
        </Button>
        <Button color="primary" onClick={() => router.push("/settings/enterprise/teams")}>
          {t("enterprise_open_organization_access")}
        </Button>
      </div>
    </div>
  );
};
