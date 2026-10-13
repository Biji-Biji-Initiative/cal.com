"use client";

import { onboardingReturnPath } from "@calcom/features/onboarding/lib/onboarding-return-path";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { md } from "@calcom/lib/markdownIt";
import turndown from "@calcom/lib/turndownService";
import { localStorage } from "@calcom/lib/webstorage";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { UserAvatar } from "@calcom/ui/components/avatar";
import { Button } from "@calcom/ui/components/button";
import { Editor } from "@calcom/ui/components/editor";
import { Label } from "@calcom/ui/components/form";
import { ImageUploader } from "@calcom/ui/components/image-uploader";
import { showToast } from "@calcom/ui/components/toast";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

type FormData = { bio: string };
interface UserProfileProps {
  user: RouterOutputs["viewer"]["me"]["get"];
}

const UserProfile = ({ user }: UserProfileProps) => {
  const { t } = useLocale();
  const avatarRef = useRef<HTMLInputElement>(null);
  const finishing = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const { setValue, handleSubmit, getValues } = useForm<FormData>({
    defaultValues: { bio: user?.bio || "" },
  });
  const [imageSrc, setImageSrc] = useState<string>(user?.avatar || "");
  const utils = trpc.useUtils();
  const router = useRouter();
  const createEventType = trpc.viewer.eventTypesHeavy.create.useMutation();
  const [firstRender, setFirstRender] = useState(true);

  const avatarMutation = trpc.viewer.me.updateProfile.useMutation({
    onSuccess: async (data) => {
      showToast(t("your_user_profile_updated_successfully"), "success");
      setImageSrc(data.avatarUrl ?? "");
    },
    onError: () => {
      showToast(t("problem_saving_user_profile"), "error");
    },
  });
  const mutation = trpc.viewer.me.updateProfile.useMutation();
  const defaultEventTypes = [
    { title: t("15min_meeting"), slug: "15min", length: 15 },
    { title: t("30min_meeting"), slug: "30min", length: 30 },
    { title: t("secret_meeting"), slug: "secret", length: 15, hidden: true },
  ];

  const onSubmit = handleSubmit(async ({ bio }: FormData) => {
    if (finishing.current) return;
    finishing.current = true;
    setIsFinishing(true);
    try {
      // Setup is not complete while initial event writes are pending or failed.
      const eventTypes = await utils.viewer.eventTypes.list.fetch();
      if (eventTypes.length === 0) {
        await Promise.all(defaultEventTypes.map((event) => createEventType.mutateAsync(event)));
      }
      await mutation.mutateAsync({ bio, completedOnboarding: true });
      await utils.viewer.me.get.refetch();
      posthog.capture("onboarding_completed");
      const destination = onboardingReturnPath(localStorage.getItem("onBoardingRedirect"));
      localStorage.removeItem("onBoardingRedirect");
      router.push(destination);
    } catch {
      showToast(t("problem_saving_user_profile"), "error");
    } finally {
      finishing.current = false;
      setIsFinishing(false);
    }
  });

  async function updateProfileHandler(newAvatar: string) {
    avatarMutation.mutate({ avatarUrl: newAvatar });
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="flex flex-row items-center justify-start rtl:justify-end">
        {user && <UserAvatar size="lg" user={user} previewSrc={imageSrc} />}
        <input
          ref={avatarRef}
          type="hidden"
          name="avatar"
          id="avatar"
          placeholder="URL"
          className="border-default focus:ring-empthasis mt-1 block w-full rounded-sm border px-3 py-2 text-sm focus:border-gray-800 focus:outline-none"
          defaultValue={imageSrc}
        />
        <div className="flex items-center px-4">
          <ImageUploader
            target="avatar"
            id="avatar-upload"
            buttonMsg={t("add_profile_photo")}
            handleAvatarChange={(newAvatar) => {
              if (avatarRef.current) avatarRef.current.value = newAvatar;
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
              )?.set;
              nativeInputValueSetter?.call(avatarRef.current, newAvatar);
              avatarRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
              updateProfileHandler(newAvatar);
            }}
            imageSrc={imageSrc}
          />
        </div>
      </div>
      <fieldset className="mt-8">
        <Label className="text-default mb-2 block text-sm font-medium">{t("about")}</Label>
        <Editor
          getText={() => md.render(getValues("bio") || user?.bio || "")}
          setText={(value: string) => setValue("bio", turndown(value))}
          excludedToolbarItems={["blockType"]}
          firstRender={firstRender}
          setFirstRender={setFirstRender}
        />
        <p className="text-default mt-2 font-sans text-sm font-normal">{t("few_sentences_about_yourself")}</p>
      </fieldset>
      <Button
        loading={isFinishing}
        disabled={isFinishing}
        data-testid="finish-onboarding"
        EndIcon="arrow-right"
        type="submit"
        className="mt-8 w-full items-center justify-center">
        {t("finish_and_start")}
      </Button>
    </form>
  );
};
export default UserProfile;
