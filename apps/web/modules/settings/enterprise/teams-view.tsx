"use client";

import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import OrganizationInvitations from "./organization-invitations";
import OrganizationProvisioning from "./organization-provisioning";

function useOperationKey() {
  const last = useRef<{ signature: string; requestId: string } | null>(null);
  return {
    get(input: object) {
      const signature = JSON.stringify(input);
      if (last.current?.signature !== signature) last.current = { signature, requestId: crypto.randomUUID() };
      return last.current.requestId;
    },
    reset() {
      last.current = null;
    },
  };
}

export default function EnterpriseTeamsView() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const query = trpc.viewer.enterpriseTeams.overview.useQuery();
  const create = trpc.viewer.enterpriseTeams.create.useMutation();
  const membership = trpc.viewer.enterpriseTeams.setMember.useMutation();
  const operation = useOperationKey();
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = query.data?.find((entry) => entry.organization.id === selected) ?? query.data?.[0];
  const busy = create.isPending || membership.isPending;
  const controlClass =
    "border-default bg-default text-emphasis mt-1 w-full rounded-md border px-3 py-2 text-sm";

  async function finish(action: () => Promise<unknown>) {
    setError(null);
    setNotice(null);
    try {
      await action();
      operation.reset();
      await utils.viewer.enterpriseTeams.overview.invalidate();
      setNotice(t("enterprise_team_saved"));
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
      return false;
    }
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      organizationId: current.organization.id,
      name: String(data.get("name")),
      slug: String(data.get("slug")),
      timeZone: String(data.get("timeZone")),
    };
    if (await finish(() => create.mutateAsync({ ...input, requestId: operation.get(input) }))) form.reset();
  }

  async function setMember(event: FormEvent<HTMLFormElement>, teamId: number) {
    event.preventDefault();
    if (!current) return;
    const data = new FormData(event.currentTarget);
    const input = {
      organizationId: current.organization.id,
      teamId,
      userId: Number(data.get("userId")),
      role: String(data.get("role")) as "MEMBER" | "ADMIN" | "OWNER",
    };
    await finish(() => membership.mutateAsync({ ...input, requestId: operation.get(input) }));
  }

  return (
    <SettingsHeader title={t("enterprise_teams_title")} description={t("enterprise_teams_description")}>
      <div className="space-y-6" data-testid="enterprise-teams">
        <OrganizationInvitations />
        <OrganizationProvisioning
          onCreated={async (organizationId) => {
            setSelected(organizationId);
            await utils.viewer.enterpriseTeams.overview.invalidate();
          }}
        />

        {query.isPending && <p role="status">{t("loading")}</p>}
        {(query.error || error) && (
          <p role="alert" className="text-red-700">
            {error ?? query.error?.message}
          </p>
        )}
        {notice && (
          <p role="status" className="text-subtle">
            {notice}
          </p>
        )}
        {query.data?.length === 0 && <p>{t("enterprise_no_organization")}</p>}
        {current && (
          <>
            <label className="block text-sm font-medium">
              {t("enterprise_organization")}
              <select
                className={controlClass}
                value={current.organization.id}
                disabled={busy}
                onChange={(event) => {
                  setSelected(Number(event.target.value));
                  setError(null);
                  setNotice(null);
                }}>
                {query.data?.map(({ organization }) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            {current.canInvite && (
              <OrganizationInvitations
                key={current.organization.id}
                organizationId={current.organization.id}
              />
            )}
            {current.canManage && (
              <form
                onSubmit={createTeam}
                className="border-subtle rounded-lg border p-4"
                data-testid="create-team">
                <h2 className="mb-3 text-base font-semibold">{t("enterprise_create_team")}</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    {t("enterprise_team_name")}
                    <input name="name" required maxLength={100} className={controlClass} />
                  </label>
                  <label className="text-sm">
                    {t("enterprise_team_slug")}
                    <input
                      name="slug"
                      required
                      maxLength={80}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      className={controlClass}
                    />
                  </label>
                  <label className="text-sm">
                    {t("timezone")}
                    <input
                      name="timeZone"
                      required
                      maxLength={80}
                      defaultValue={current.organization.timeZone}
                      className={controlClass}
                    />
                  </label>
                </div>
                <Button type="submit" disabled={busy} className="mt-4">
                  {t("enterprise_create_team")}
                </Button>
              </form>
            )}
            {!current.canManage && <p className="text-subtle text-sm">{t("enterprise_team_read_only")}</p>}
            {current.teams.length === 0 && <p className="text-subtle">{t("enterprise_no_teams")}</p>}
            {current.teams.map((team) => (
              <section
                key={team.id}
                className="border-subtle space-y-4 rounded-lg border p-4"
                aria-labelledby={`team-${team.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 id={`team-${team.id}`} className="font-semibold">
                    {team.name}
                  </h2>
                  <Link href={`/event-types?teamId=${team.id}`} className="text-emphasis text-sm underline">
                    {t("enterprise_manage_events")}
                  </Link>
                </div>
                <ul className="space-y-1 text-sm">
                  {team.members.map((member) => (
                    <li key={member.userId} className="flex justify-between gap-4">
                      <span>{member.user.name ?? member.user.username ?? `#${member.userId}`}</span>
                      <span className="text-subtle">
                        {member.customRoleId
                          ? t("enterprise_custom_role")
                          : t(
                              member.role === "OWNER"
                                ? "enterprise_role_owner"
                                : member.role === "ADMIN"
                                  ? "enterprise_role_admin"
                                  : "enterprise_role_member"
                            )}
                      </span>
                    </li>
                  ))}
                </ul>
                {team.eventTypes.length > 0 && (
                  <div className="space-y-1 text-sm">
                    <h3 className="font-medium">{t("enterprise_booking_links")}</h3>
                    {team.eventTypes.map((event) => (
                      <div key={event.id}>
                        {event.schedulingType !== "MANAGED" && team.slug && current.organization.slug ? (
                          <Link
                            className="underline"
                            href={`/org/${encodeURIComponent(current.organization.slug)}/team/${encodeURIComponent(team.slug)}/${encodeURIComponent(event.slug)}`}>
                            {event.title}
                          </Link>
                        ) : (
                          event.title
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {team.directoryManaged ? (
                  <p className="text-subtle text-sm">{t("enterprise_directory_managed")}</p>
                ) : (
                  current.canManage && (
                    <form
                      onSubmit={(event) => setMember(event, team.id)}
                      className="grid gap-3 sm:grid-cols-[1fr_150px_auto]"
                      data-testid={`team-member-form-${team.id}`}>
                      <label className="text-sm">
                        {t("enterprise_person")}
                        <select required name="userId" className={controlClass} defaultValue="">
                          <option value="" disabled>
                            {t("enterprise_select_member")}
                          </option>
                          {current.eligibleMembers.map(({ userId, user }) => (
                            <option key={userId} value={userId}>
                              {user.name ?? user.username ?? `#${userId}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        {t("enterprise_role")}
                        <select name="role" className={controlClass} defaultValue="MEMBER">
                          <option value="MEMBER">{t("enterprise_role_member")}</option>
                          <option value="ADMIN">{t("enterprise_role_admin")}</option>
                          <option value="OWNER">{t("enterprise_role_owner")}</option>
                        </select>
                      </label>
                      <Button type="submit" disabled={busy} className="self-end">
                        {t("enterprise_save_member")}
                      </Button>
                    </form>
                  )
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </SettingsHeader>
  );
}
