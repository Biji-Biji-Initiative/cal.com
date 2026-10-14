"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { type FormEvent, useState } from "react";

type Review = RouterOutputs["viewer"]["enterpriseTeams"]["reviewOrganization"];
export default function OrganizationProvisioning({
  onCreated,
}: {
  onCreated: (id: number) => Promise<void>;
}) {
  const { t } = useLocale();
  const capabilities = trpc.viewer.enterpriseTeams.provisioningCapabilities.useQuery();
  const reviewMutation = trpc.viewer.enterpriseTeams.reviewOrganization.useMutation();
  const provision = trpc.viewer.enterpriseTeams.provisionOrganization.useMutation();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const busy = reviewMutation.isPending || provision.isPending;
  const control = "border-default bg-default text-emphasis mt-1 w-full rounded-md border px-3 py-2 text-sm";

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReview(null);
    setError(null);
    setCreatedId(null);
    const values = new FormData(event.currentTarget);
    try {
      const result = await reviewMutation.mutateAsync({
        name: String(values.get("name")),
        slug: String(values.get("slug")),
        timeZone: String(values.get("timeZone")),
        ownerEmail: String(values.get("ownerEmail")),
        memberEmails: String(values.get("memberEmails") || "")
          .split(/[\n,;]/)
          .map((email) => email.trim())
          .filter(Boolean),
      });
      setReview(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    }
  }
  async function create() {
    if (!review || busy) return;
    setError(null);
    try {
      // Retain the reviewed request ID on failure, including an ambiguous lost
      // response. Repeated confirmation must not create another organization.
      const result = await provision.mutateAsync(review.input);
      setCreatedId(result.organizationId);
      setReview(null);
      await onCreated(result.organizationId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    }
  }
  if (capabilities.isPending) return <p role="status">{t("loading")}</p>;
  if (capabilities.error) return <p role="alert">{capabilities.error.message}</p>;
  if (!capabilities.data?.canProvision) return null;
  return (
    <section className="border-subtle rounded-lg border p-4" data-testid="organization-provisioning">
      <h2 className="text-base font-semibold">{t("enterprise_provision_title")}</h2>
      <p className="text-subtle mt-1 text-sm">{t("enterprise_provision_description")}</p>
      <form
        onSubmit={inspect}
        onChange={() => {
          setReview(null);
          setCreatedId(null);
          setError(null);
        }}
        className="mt-4 space-y-3"
        data-testid="review-organization">
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            {t("enterprise_organization_name")}
            <input className={control} name="name" required maxLength={100} />
          </label>
          <label className="text-sm">
            {t("enterprise_organization_address")}
            <input className={control} name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} />
          </label>
          <label className="text-sm">
            {t("timezone")}
            <input className={control} name="timeZone" required defaultValue="UTC" maxLength={80} />
          </label>
          <label className="text-sm">
            {t("enterprise_initial_owner")}
            <input
              className={control}
              name="ownerEmail"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            {t("enterprise_initial_members")}
            <textarea className={control} name="memberEmails" maxLength={5100} rows={3} />
          </label>
          <Button type="submit" color="secondary" loading={reviewMutation.isPending} disabled={busy}>
            {t("enterprise_review_admission")}
          </Button>
        </fieldset>
      </form>
      {review && (
        <div className="bg-subtle mt-4 rounded-lg p-4" data-testid="organization-review">
          <h3 className="font-semibold">
            {review.input.name} <span className="font-normal">(/org/{review.input.slug})</span>
          </h3>
          <p className="mt-1 text-sm">{t("enterprise_review_admission_warning")}</p>
          <ul className="my-3 space-y-1 text-sm">
            {review.accounts.map((account) => (
              <li key={account.id}>
                {account.name || account.email} — {account.email} —{" "}
                {t(account.role === "OWNER" ? "enterprise_role_owner" : "enterprise_role_member")}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={create}
            loading={provision.isPending}
            disabled={busy}
            data-testid="confirm-organization">
            {t("enterprise_confirm_admission")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
      {createdId !== null && (
        <p role="status" className="mt-3" data-testid="organization-created">
          {t("enterprise_provision_success", { id: createdId })}
        </p>
      )}
    </section>
  );
}
