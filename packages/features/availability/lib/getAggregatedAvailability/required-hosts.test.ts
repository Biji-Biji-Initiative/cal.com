// SPDX-License-Identifier: MIT
import dayjs from "@calcom/dayjs";
import { describe, expect, it } from "vitest";
import { getAggregatedAvailability } from "./getAggregatedAvailability";

const span = (start: number, end: number) => ({
  start: dayjs.utc(`2030-01-14T${String(start).padStart(2, "0")}:00:00Z`),
  end: dayjs.utc(`2030-01-14T${String(end).padStart(2, "0")}:00:00Z`),
});
const host = (isFixed: boolean, ranges: ReturnType<typeof span>[], groupId: string | null = null) => ({
  user: { isFixed, groupId },
  dateRanges: ranges,
  oooExcludedDateRanges: ranges,
});

describe("required-host availability cannot disappear from intersection", () => {
  it("does not offer a rotating host's slots when a required fixed host has none", () => {
    expect(getAggregatedAvailability([host(true, []), host(false, [span(9, 17)])], "ROUND_ROBIN")).toEqual(
      []
    );
  });
  it("does not drop mutually unavailable fixed hosts when a rotating host is free", () => {
    expect(
      getAggregatedAvailability(
        [host(true, [span(9, 10)]), host(true, [span(11, 12)]), host(false, [span(9, 17)])],
        "ROUND_ROBIN"
      )
    ).toEqual([]);
  });
  it("requires every collective participant even with legacy non-fixed flags", () => {
    expect(
      getAggregatedAvailability([host(false, [span(9, 10)]), host(false, [span(11, 12)])], "COLLECTIVE")
    ).toEqual([]);
  });
  it("still returns the intersection of fixed and eligible rotating hosts", () => {
    expect(
      getAggregatedAvailability([host(true, [span(9, 12)]), host(false, [span(10, 11)])], "ROUND_ROBIN")
    ).toEqual([span(10, 11)]);
  });
  it("does not require an absent fixed-host class for ordinary round robin", () => {
    expect(getAggregatedAvailability([host(false, [span(9, 10)])], "ROUND_ROBIN")).toEqual([span(9, 10)]);
  });
});
