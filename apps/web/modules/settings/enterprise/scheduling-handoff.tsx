"use client";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { useRef, useState } from "react";

type Review = RouterOutputs["viewer"]["enterpriseTeams"]["reviewSchedulingHandoff"];
type Person = { id: number; uuid: string; name: string | null; email: string };
export default function SchedulingHandoff({
  organizationId,
  source,
  onClose,
}: {
  organizationId: number;
  source: Person;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [cursor, setCursor] = useState<number>();
  const [candidateCursor, setCandidateCursor] = useState<number>();
  const [eventId, setEventId] = useState<number>();
  const [successorId, setSuccessorId] = useState<number>();
  const [scheduleId, setScheduleId] = useState<number>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const running = useRef(false);
  const sourceIdentity = { id: source.id, uuid: source.uuid };
  const events = trpc.viewer.enterpriseTeams.handoffEvents.useQuery(
    { organizationId, source: sourceIdentity, cursor },
    { retry: false }
  );
  const options = trpc.viewer.enterpriseTeams.handoffOptions.useQuery(
    { organizationId, source: sourceIdentity, eventTypeId: eventId ?? 0, cursor: candidateCursor },
    { enabled: eventId !== undefined, retry: false }
  );
  const inspect = trpc.viewer.enterpriseTeams.reviewSchedulingHandoff.useMutation();
  const commit = trpc.viewer.enterpriseTeams.commitSchedulingHandoff.useMutation();
  const busy = inspect.isPending || commit.isPending;
  const successor = options.data?.items.find((person) => person.id === successorId);
  const control = "border-default bg-default text-emphasis mt-1 w-full rounded-md border px-3 py-2 text-sm";
  function changed() {
    setReview(null);
    setError(null);
    setRecorded(false);
  }
  async function prepare() {
    if (!eventId || !successor || !scheduleId || running.current) return;
    running.current = true;
    changed();
    try {
      setReview(
        await inspect.mutateAsync({
          organizationId,
          source: sourceIdentity,
          eventTypeId: eventId,
          successor: { id: successor.id, uuid: successor.uuid },
          successorScheduleId: scheduleId,
        })
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    } finally {
      running.current = false;
    }
  }
  async function apply() {
    if (!review || review.blockers.length || running.current) return;
    running.current = true;
    setError(null);
    try {
      await commit.mutateAsync(review.input);
      setReview(null);
      setRecorded(true);
      setEventId(undefined);
      setSuccessorId(undefined);
      setScheduleId(undefined);
      await Promise.all([
        utils.viewer.enterpriseTeams.handoffEvents.invalidate(),
        utils.viewer.enterpriseTeams.handoffOptions.invalidate(),
        utils.viewer.enterpriseTeams.overview.invalidate(),
        utils.viewer.enterpriseTeams.organizationMembers.invalidate(),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("something_went_wrong"));
    } finally {
      running.current = false;
    }
  }
  return (
    <section className="bg-subtle space-y-3 rounded-lg p-4" data-testid="scheduling-handoff">
      <h3 className="font-semibold">
        {t("enterprise_handoff_title")} — {source.name || source.email}
      </h3>
      <p className="text-sm">{t("enterprise_handoff_description")}</p>
      {(error || events.error || options.error) && (
        <p role="alert">{error || events.error?.message || options.error?.message}</p>
      )}
      {recorded && (
        <p role="status" data-testid="handoff-recorded">
          {t("enterprise_handoff_recorded")}
        </p>
      )}
      {events.isPending && <p role="status">{t("loading")}</p>}
      {events.data?.items.length === 0 && <p>{t("enterprise_handoff_no_events")}</p>}
      <label className="block text-sm">
        {t("enterprise_handoff_event")}
        <select
          className={control}
          data-testid="handoff-event"
          value={eventId ?? ""}
          disabled={busy}
          onChange={(event) => {
            changed();
            setEventId(event.target.value ? Number(event.target.value) : undefined);
            setSuccessorId(undefined);
            setScheduleId(undefined);
            setCandidateCursor(undefined);
          }}>
          <option value="">{t("enterprise_handoff_choose_event")}</option>
          {events.data?.items.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title} · {event.slug} · #{event.id}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        {events.data?.nextCursor != null && (
          <Button
            type="button"
            color="secondary"
            disabled={busy}
            onClick={() => {
              changed();
              setEventId(undefined);
              setCursor(events.data?.nextCursor ?? undefined);
            }}>
            {t("enterprise_handoff_more_events")}
          </Button>
        )}
        {cursor !== undefined && (
          <Button
            type="button"
            color="secondary"
            disabled={busy}
            onClick={() => {
              changed();
              setEventId(undefined);
              setCursor(undefined);
            }}>
            {t("enterprise_members_first")}
          </Button>
        )}
      </div>
      {eventId && (
        <>
          <label className="block text-sm">
            {t("enterprise_handoff_successor")}
            <select
              className={control}
              data-testid="handoff-successor"
              value={successorId ?? ""}
              disabled={busy || options.isPending}
              onChange={(event) => {
                changed();
                setSuccessorId(event.target.value ? Number(event.target.value) : undefined);
                setScheduleId(undefined);
              }}>
              <option value="">{t("enterprise_handoff_choose_successor")}</option>
              {options.data?.items.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name || person.email} · {person.email}
                </option>
              ))}
            </select>
          </label>
          {options.data?.nextCursor != null && (
            <Button
              type="button"
              color="secondary"
              disabled={busy}
              onClick={() => {
                changed();
                setSuccessorId(undefined);
                setScheduleId(undefined);
                setCandidateCursor(options.data?.nextCursor ?? undefined);
              }}>
              {t("enterprise_handoff_more_people")}
            </Button>
          )}
          {candidateCursor !== undefined && (
            <Button
              type="button"
              color="secondary"
              disabled={busy}
              onClick={() => {
                changed();
                setSuccessorId(undefined);
                setScheduleId(undefined);
                setCandidateCursor(undefined);
              }}>
              {t("enterprise_members_first")}
            </Button>
          )}
        </>
      )}
      {successor && (
        <label className="block text-sm">
          {t("enterprise_handoff_schedule")}
          <select
            className={control}
            data-testid="handoff-schedule"
            value={scheduleId ?? ""}
            disabled={busy}
            onChange={(event) => {
              changed();
              setScheduleId(event.target.value ? Number(event.target.value) : undefined);
            }}>
            <option value="">{t("enterprise_handoff_choose_schedule")}</option>
            {successor.schedules
              .filter((schedule) => schedule._count.availability > 0)
              .map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name} · {schedule.timeZone || "UTC"} · #{schedule.id}
                </option>
              ))}
          </select>
          {successor.schedulesTruncated && (
            <span role="status">{t("enterprise_handoff_schedule_limit")}</span>
          )}
        </label>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={prepare}
          disabled={busy || !eventId || !successor || !scheduleId}
          loading={inspect.isPending}
          data-testid="review-handoff">
          {t("enterprise_handoff_review")}
        </Button>
        <Button type="button" color="secondary" onClick={onClose} disabled={busy}>
          {t("close")}
        </Button>
      </div>
      {review && (
        <div className="border-subtle space-y-3 rounded-lg border p-3" data-testid="handoff-review">
          <h4 className="font-semibold">
            {review.event.title} → {review.successor.name || review.successor.email}
          </h4>
          <p>
            {review.schedule.name} · {review.schedule.timeZone || "UTC"}
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(review.effects).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`enterprise_handoff_effect_${key}`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {review.blockers.length > 0 && (
            <div role="alert" data-testid="handoff-blockers">
              <ul>
                {review.blockers.map((blocker) => (
                  <li key={blocker}>{t(`enterprise_handoff_blocker_${blocker}`)}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            type="button"
            onClick={apply}
            disabled={busy || review.blockers.length > 0}
            loading={commit.isPending}
            data-testid="confirm-handoff">
            {t("enterprise_handoff_confirm")}
          </Button>
        </div>
      )}
    </section>
  );
}
