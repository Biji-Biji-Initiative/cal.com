"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { type FormEvent, useRef, useState } from "react";

export default function OrganizationInvitations({ organizationId }: { organizationId?: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [cursor, setCursor] = useState<number | undefined>();
  const query = trpc.viewer.enterpriseTeams.invitations.useQuery({ organizationId, cursor });
  const invite = trpc.viewer.enterpriseTeams.inviteMember.useMutation();
  const respond = trpc.viewer.enterpriseTeams.respondToInvitation.useMutation();
  const cancel = trpc.viewer.enterpriseTeams.cancelInvitation.useMutation();
  const resend = trpc.viewer.enterpriseTeams.resendInvitation.useMutation();
  const operation = useRef<{ signature: string; requestId: string } | null>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function key(action: string, input: object) {
    const signature = JSON.stringify({ action, input });
    if (operation.current?.signature !== signature)
      operation.current = { signature, requestId: crypto.randomUUID() };
    return operation.current.requestId;
  }
  async function execute(
    work: () => Promise<{ email?: string } | { responseRecorded: boolean } | { cancelled: boolean }>
  ) {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await work();
      operation.current = null;
      setNotice(
        "email" in result
          ? t(
              result.email === "submitted"
                ? "enterprise_invite_mail_submitted"
                : result.email === "already_attempted"
                  ? "enterprise_invite_mail_unknown"
                  : "enterprise_invite_mail_failed"
            )
          : t("enterprise_invite_response_saved")
      );
      await Promise.all([
        utils.viewer.enterpriseTeams.invitations.invalidate(),
        utils.viewer.enterpriseTeams.overview.invalidate(),
        utils.viewer.me.get.invalidate(),
      ]);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (organizationId === undefined) return;
    const form = event.currentTarget;
    const input = { organizationId, email: String(new FormData(form).get("email")) };
    if (await execute(() => invite.mutateAsync({ ...input, requestId: key("invite", input) }))) form.reset();
  }
  if (
    !organizationId &&
    !query.isPending &&
    !query.error &&
    !query.data?.items.length &&
    cursor === undefined
  )
    return null;
  return (
    <section
      className="border-subtle space-y-3 rounded-lg border p-4"
      data-testid={organizationId ? "organization-invitations" : "invitation-inbox"}>
      <h2 className="text-base font-semibold">
        {t(organizationId ? "enterprise_pending_invitations" : "enterprise_your_invitations")}
      </h2>
      <p className="text-subtle text-sm">
        {t(organizationId ? "enterprise_invite_description" : "enterprise_invite_consent")}
      </p>
      {organizationId !== undefined && (
        <form
          onSubmit={send}
          className="flex flex-wrap items-end gap-3"
          data-testid="invite-organization-member">
          <label className="text-sm">
            {t("enterprise_invite_email")}
            <input
              type="email"
              name="email"
              required
              maxLength={254}
              disabled={busy}
              className="border-default bg-default text-emphasis mt-1 block rounded-md border px-3 py-2"
            />
          </label>
          <Button type="submit" disabled={busy} loading={invite.isPending}>
            {t("enterprise_send_invitation")}
          </Button>
        </form>
      )}
      {(query.error || error) && <p role="alert">{error ?? query.error?.message}</p>}
      {notice && <p role="status">{notice}</p>}
      {query.isPending && <p role="status">{t("loading")}</p>}
      {query.data?.items.map((invitation) => (
        <div
          key={invitation.id}
          className="border-subtle rounded-md border p-3"
          data-testid={`invitation-${invitation.id}`}>
          <p className="font-medium">
            {organizationId ? invitation.recipient.email : invitation.organizationName}
          </p>
          <p className="text-subtle text-sm">
            {t("enterprise_invite_membership_scope")} ·{" "}
            {t("enterprise_invite_expires", { when: new Date(invitation.expires).toLocaleString() })}
          </p>
          {!invitation.actionable && (
            <p className="text-subtle text-sm">{t("enterprise_invite_unavailable")}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {organizationId !== undefined ? (
              <>
                <Button
                  type="button"
                  color="secondary"
                  disabled={busy || !invitation.actionable}
                  onClick={() => {
                    const input = { organizationId, invitationId: invitation.id };
                    void execute(() => resend.mutateAsync({ ...input, requestId: key("resend", input) }));
                  }}>
                  {t("enterprise_resend_invitation")}
                </Button>
                <Button
                  type="button"
                  color="secondary"
                  disabled={busy}
                  onClick={() => {
                    const input = { organizationId, invitationId: invitation.id };
                    void execute(() => cancel.mutateAsync({ ...input, requestId: key("cancel", input) }));
                  }}>
                  {t("enterprise_cancel_invitation")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  disabled={busy || !invitation.actionable}
                  onClick={() => {
                    const input = { invitationId: invitation.id, decision: "accept" as const };
                    void execute(() => respond.mutateAsync({ ...input, requestId: key("respond", input) }));
                  }}>
                  {t("enterprise_accept_invitation")}
                </Button>
                <Button
                  type="button"
                  color="secondary"
                  disabled={busy}
                  onClick={() => {
                    const input = { invitationId: invitation.id, decision: "decline" as const };
                    void execute(() => respond.mutateAsync({ ...input, requestId: key("respond", input) }));
                  }}>
                  {t("enterprise_decline_invitation")}
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
      {query.data?.items.length === 0 && <p className="text-sm">{t("enterprise_no_pending_invitations")}</p>}
      <div className="flex gap-2">
        {cursor !== undefined && (
          <Button color="secondary" disabled={busy} onClick={() => setCursor(undefined)}>
            {t("enterprise_invites_first_page")}
          </Button>
        )}
        {query.data?.nextCursor && (
          <Button
            color="secondary"
            disabled={busy}
            onClick={() => setCursor(query.data?.nextCursor ?? undefined)}>
            {t("enterprise_invites_next_page")}
          </Button>
        )}
      </div>
    </section>
  );
}
