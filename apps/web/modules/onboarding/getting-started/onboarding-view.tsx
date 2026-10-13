"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Compatibility for downstream imports; the server entry redirects before this
// mounts. Persisted purchase-plan state never selects a tenant or grants access.
export const OnboardingView = (_props: { userEmail: string }) => {
  const router = useRouter();
  const { t } = useLocale();
  useEffect(() => {
    router.replace("/getting-started");
  }, [router]);
  return <p role="status">{t("loading")}</p>;
};
