"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { buttonClasses } from "@calcom/ui/components/button";
import AuthContainer from "@components/ui/AuthContainer";

export default function PublicWelcome() {
  const { t } = useLocale();

  return (
    <AuthContainer>
      <main>
        <h1 className="font-cal text-emphasis mb-3 text-center text-3xl">
          {t("welcome_to_calcom", { appName: "Cal" })}
        </h1>
        <p className="text-subtle mb-6 text-center">{t("mereka_public_welcome_description")}</p>
        <a
          href="/auth/mereka?rd=%2Fevent-types"
          className={`${buttonClasses({ color: "primary", size: "lg" })} w-full justify-center`}>
          {t("signin_with_mereka")}
        </a>
      </main>
    </AuthContainer>
  );
}
