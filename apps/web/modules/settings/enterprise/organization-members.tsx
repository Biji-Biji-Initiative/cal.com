"use client";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { useRef, useState } from "react";
import SchedulingHandoff from "./scheduling-handoff";

type Review = RouterOutputs["viewer"]["enterpriseTeams"]["reviewMemberChange"];
type Member = RouterOutputs["viewer"]["enterpriseTeams"]["organizationMembers"]["items"][number];
export default function OrganizationMembers({ organizationId }: { organizationId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [cursor, setCursor] = useState<number | undefined>();
  const query = trpc.viewer.enterpriseTeams.organizationMembers.useQuery(
    { organizationId, cursor },
    { retry: false }
  );
  const preview = trpc.viewer.enterpriseTeams.reviewMemberChange.useMutation();
  const commit = trpc.viewer.enterpriseTeams.commitMemberChange.useMutation();
  const [review, setReview] = useState<Review | null>(null);
  const [handoff, setHandoff] = useState<Member["user"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const running = useRef(false);
  const busy = preview.isPending || commit.isPending;
  async function inspect(
    member: Member,
    operation: "remove" | "set-role" | "transfer-ownership",
    role?: "MEMBER" | "ADMIN"
  ) {
    if (running.current) return;
    running.current = true;
    setError(null);
    setReview(null);
    setNotice(false);
    setHandoff(null);
    try {
      setReview(
        await preview.mutateAsync({
          organizationId,
          target: { id: member.userId, uuid: member.user.uuid },
          operation,
          ...(role ? { role } : {}),
        })
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    } finally {
      running.current = false;
    }
  }
  async function confirm() {
    if (!review || review.blockers.length || running.current) return;
    running.current = true;
    setError(null);
    try {
      await commit.mutateAsync(review.input);
      setReview(null);
      setNotice(true);
      await Promise.all([
        utils.viewer.enterpriseTeams.organizationMembers.invalidate(),
        utils.viewer.enterpriseTeams.overview.invalidate(),
        utils.viewer.enterpriseTeams.invitations.invalidate(),
      ]);
    } catch (failure) {
      // Keep the reviewed operation ID when a response is lost; the server
      // rechecks current authority and will not silently reapply old grants.
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    } finally {
      running.current = false;
    }
  }
  return (
    <section className="border-subtle space-y-3 rounded-lg border p-4" data-testid="organization-members">
      <h2 className="text-base font-semibold">{t("enterprise_members_title")}</h2>
      <p className="text-subtle text-sm">{t("enterprise_members_description")}</p>
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      {notice && <p role="status">{t("enterprise_member_change_recorded")}</p>}
      {query.isPending && <p role="status">{t("loading")}</p>}
      {query.data?.items.map((member) => {
        const owner = query.data.actorRole === "OWNER";
        const special = member.customRoleId !== null || member.user.isPlatformManaged;
        const canRemove =
          !special && (owner || member.role === "MEMBER" || member.userId === query.data.actorId);
        return (
          <div
            key={member.id}
            className="border-subtle rounded-md border p-3"
            data-testid={`organization-member-${member.userId}`}>
            <p className="font-medium">{member.user.name || member.user.email}</p>
            <p className="text-subtle text-sm">
              {member.user.email} · {t(`enterprise_member_role_${member.role.toLowerCase()}`)}
              {member.user.locked ? ` · ${t("enterprise_member_locked")}` : ""}
            </p>
            {special ? (
              <p className="text-subtle text-sm">{t("enterprise_member_special_role")}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  color="secondary"
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setError(null);
                    setNotice(false);
                    setHandoff(member.user);
                  }}
                  data-testid="open-scheduling-handoff">
                  {t("enterprise_handoff_open")}
                </Button>

                {owner && !member.user.locked && (
                  <Button
                    type="button"
                    color="secondary"
                    disabled={busy}
                    onClick={() => inspect(member, "set-role", member.role === "MEMBER" ? "ADMIN" : "MEMBER")}
                    data-testid="review-role">
                    {t(
                      member.role === "MEMBER"
                        ? "enterprise_member_make_admin"
                        : "enterprise_member_make_member"
                    )}
                  </Button>
                )}
                {owner &&
                  !member.user.locked &&
                  member.role !== "OWNER" &&
                  member.userId !== query.data.actorId && (
                    <Button
                      type="button"
                      color="secondary"
                      disabled={busy}
                      onClick={() => inspect(member, "transfer-ownership")}
                      data-testid="review-transfer">
                      {t("enterprise_member_transfer_ownership")}
                    </Button>
                  )}
                {canRemove && (
                  <Button
                    type="button"
                    color="secondary"
                    disabled={busy}
                    onClick={() => inspect(member, "remove")}
                    data-testid="review-removal">
                    {t("enterprise_member_review_removal")}
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {query.data?.nextCursor !== null && query.data?.nextCursor !== undefined && (
        <Button
          type="button"
          color="secondary"
          disabled={busy}
          onClick={() => {
            setReview(null);
            setCursor(query.data?.nextCursor ?? undefined);
          }}>
          {t("enterprise_members_next")}
        </Button>
      )}
      {cursor !== undefined && (
        <Button
          type="button"
          color="secondary"
          disabled={busy}
          onClick={() => {
            setReview(null);
            setCursor(undefined);
          }}>
          {t("enterprise_members_first")}
        </Button>
      )}
      {handoff && (
        <SchedulingHandoff
          key={`${organizationId}-${handoff.uuid}`}
          organizationId={organizationId}
          source={handoff}
          onClose={() => setHandoff(null)}
        />
      )}
      {review && (
        <div className="bg-subtle space-y-3 rounded-lg p-4" data-testid="member-change-review">
          <h3 className="font-semibold">
            {t(`enterprise_member_operation_${review.input.operation}`)} —{" "}
            {review.target.name || review.target.email}
          </h3>
          <p className="text-sm">
            {t(
              review.input.operation === "remove"
                ? "enterprise_member_remove_explanation"
                : review.input.operation === "transfer-ownership"
                  ? "enterprise_member_transfer_explanation"
                  : "enterprise_member_role_explanation"
            )}
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(review.effects).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`enterprise_member_effect_${key}`)}</dt>
                <dd className="font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {review.blockers.length > 0 && (
            <div role="alert" data-testid="member-change-blockers">
              <p className="font-semibold">{t("enterprise_member_handoff_required")}</p>
              <ul className="list-disc pl-5">
                {review.blockers.map((blocker) => (
                  <li key={blocker}>{t(`enterprise_member_blocker_${blocker}`)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={busy || review.blockers.length > 0}
              loading={commit.isPending}
              onClick={confirm}
              data-testid="confirm-member-change">
              {t("enterprise_member_confirm_change")}
            </Button>
            <Button
              type="button"
              color="secondary"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError(null);
              }}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
