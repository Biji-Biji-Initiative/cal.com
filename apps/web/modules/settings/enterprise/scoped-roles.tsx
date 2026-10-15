"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { type FormEvent, useRef, useState } from "react";

type Review = RouterOutputs["viewer"]["enterpriseRoles"]["review"];
type Permission = "eventType.read" | "booking.readTeamBookings";
const labelKey = (permission: string) =>
  permission === "eventType.read"
    ? "enterprise_role_permission_events"
    : "enterprise_role_permission_bookings";

function ScopeEditor({ organizationId, scopeId }: { organizationId: number; scopeId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const scope = { organizationId, scopeId };
  const capability = trpc.viewer.enterpriseRoles.capability.useQuery(scope);
  const catalog = trpc.viewer.enterpriseRoles.catalog.useQuery(scope, {
    enabled: capability.data?.canManageRoles === true,
  });
  const create = trpc.viewer.enterpriseRoles.create.useMutation();
  const inspect = trpc.viewer.enterpriseRoles.review.useMutation();
  const assign = trpc.viewer.enterpriseRoles.assign.useMutation();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const busy = create.isPending || inspect.isPending || assign.isPending;
  const control = "border-default bg-default text-emphasis mt-1 w-full rounded-md border px-3 py-2 text-sm";

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const permissions = data
      .getAll("permissions")
      .map(String)
      .filter(
        (value): value is Permission => value === "eventType.read" || value === "booking.readTeamBookings"
      );
    const input = {
      ...scope,
      name: String(data.get("name")),
      description: String(data.get("description") || ""),
      permissions,
    };
    const signature = JSON.stringify(input);
    if (operation.current?.signature !== signature)
      operation.current = { signature, id: crypto.randomUUID() };
    try {
      await create.mutateAsync({ ...input, requestId: operation.current.id });
      operation.current = null;
      form.reset();
      await catalog.refetch();
      setNotice(t("enterprise_custom_role_created"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    }
  }
  async function reviewAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !catalog.data) return;
    setError(null);
    setNotice(null);
    setReview(null);
    const data = new FormData(event.currentTarget);
    const target = catalog.data.members.find((member) => member.user.id === Number(data.get("userId")));
    if (!target) return;
    try {
      setReview(
        await inspect.mutateAsync({
          ...scope,
          target: { id: target.user.id, uuid: target.user.uuid },
          roleId: String(data.get("roleId") || "") || null,
        })
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    }
  }
  async function confirm() {
    if (!review || busy) return;
    setError(null);
    try {
      await assign.mutateAsync(review.input);
      setReview(null);
      await Promise.all([catalog.refetch(), utils.viewer.enterpriseTeams.overview.invalidate()]);
      setNotice(t("enterprise_custom_role_recorded"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    }
  }
  if (capability.isPending) return <p role="status">{t("loading")}</p>;
  if (capability.error) return <p role="alert">{capability.error.message}</p>;
  if (!capability.data?.canManageRoles)
    return <p className="text-subtle text-sm">{t("enterprise_roles_owner_required")}</p>;
  return (
    <div className="space-y-4" data-testid="scoped-role-editor">
      <p className="text-subtle text-sm">{t("enterprise_roles_catalogue_boundary")}</p>
      {(catalog.error || error) && (
        <p role="alert" className="text-red-700">
          {error ?? catalog.error?.message}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="role-notice">
          {notice}
        </p>
      )}
      <form onSubmit={createRole} data-testid="create-custom-role" className="space-y-3">
        <fieldset disabled={busy} className="space-y-3">
          <legend className="font-medium">{t("enterprise_custom_role_create")}</legend>
          <label className="block text-sm">
            {t("enterprise_custom_role_name")}
            <input required name="name" maxLength={80} className={control} />
          </label>
          <label className="block text-sm">
            {t("enterprise_custom_role_description")}
            <input name="description" maxLength={240} className={control} />
          </label>
          {(["eventType.read", "booking.readTeamBookings"] as const).map((permission) => (
            <label key={permission} className="flex gap-2 text-sm">
              <input type="checkbox" name="permissions" value={permission} />
              {t(labelKey(permission))}
            </label>
          ))}
          <Button type="submit" disabled={busy}>
            {t("enterprise_custom_role_create")}
          </Button>
        </fieldset>
      </form>
      {catalog.isPending && <p role="status">{t("loading")}</p>}
      {catalog.data && (
        <>
          <ul className="space-y-2 text-sm" data-testid="custom-role-definitions">
            {catalog.data.roles.map((role) => (
              <li key={role.id}>
                <strong>{role.name}</strong> —{" "}
                {role.managed
                  ? role.permissions.map((permission) => t(labelKey(permission))).join(", ")
                  : t("enterprise_role_unmanaged")}
              </li>
            ))}
          </ul>
          <form
            onSubmit={reviewAssignment}
            onChange={() => {
              setReview(null);
              setError(null);
              setNotice(null);
            }}
            data-testid="assign-custom-role">
            <fieldset disabled={busy} className="space-y-3">
              <legend className="font-medium">{t("enterprise_custom_role_assign")}</legend>
              <label className="block text-sm">
                {t("enterprise_person")}
                <select name="userId" className={control} required defaultValue="">
                  <option value="" disabled>
                    {t("enterprise_select_member")}
                  </option>
                  {catalog.data.members.map((member) => (
                    <option key={member.id} value={member.user.id}>
                      {member.user.name || member.user.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t("enterprise_role")}
                <select name="roleId" className={control} defaultValue="">
                  <option value="">{t("enterprise_return_standard_member")}</option>
                  {catalog.data.roles
                    .filter((role) => role.managed)
                    .map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                </select>
              </label>
              <Button type="submit" color="secondary" disabled={busy}>
                {t("enterprise_review_role_assignment")}
              </Button>
            </fieldset>
          </form>
        </>
      )}
      {review && (
        <section className="bg-subtle rounded-md p-3 text-sm" data-testid="custom-role-review">
          <h3 className="font-semibold">{review.target.name || review.target.email}</h3>
          <p>
            {t("enterprise_role_before")}: {review.before?.name ?? t("enterprise_role_member")}
          </p>
          <p>
            {t("enterprise_role_after")}: {review.after?.name ?? t("enterprise_role_member")}
          </p>
          <p>{review.after?.permissions.map((permission) => t(labelKey(permission))).join(", ")}</p>
          <p className="my-3">{t("enterprise_role_review_boundary")}</p>
          <Button
            type="button"
            onClick={confirm}
            disabled={busy}
            loading={assign.isPending}
            data-testid="confirm-custom-role">
            {t("enterprise_confirm_role_assignment")}
          </Button>
        </section>
      )}
    </div>
  );
}

export default function ScopedRoles({
  organizationId,
  scopes,
}: {
  organizationId: number;
  scopes: { id: number; name: string }[];
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState(scopes[0]?.id ?? organizationId);
  const scopeId = scopes.some((scope) => scope.id === selected) ? selected : organizationId;
  return (
    <section className="border-subtle space-y-4 rounded-lg border p-4" data-testid="custom-roles">
      <h2 className="font-semibold">{t("enterprise_custom_roles_title")}</h2>
      <label className="block text-sm">
        {t("enterprise_role_exact_scope")}
        <select
          className="border-default bg-default mt-1 w-full rounded-md border px-3 py-2"
          value={scopeId}
          onChange={(event) => setSelected(Number(event.target.value))}
          data-testid="custom-role-scope">
          {scopes.map((scope) => (
            <option key={scope.id} value={scope.id}>
              {scope.name}
            </option>
          ))}
        </select>
      </label>
      <ScopeEditor key={`${organizationId}:${scopeId}`} organizationId={organizationId} scopeId={scopeId} />
    </section>
  );
}
