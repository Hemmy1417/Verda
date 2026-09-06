/**
 * The display formatters in lib/config.ts and the form helpers in
 * lib/limits.ts. Dates are UTC with a fixed month table; spans and relative
 * times use whole human units; GEN parses to atto exactly.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatGen, formatRelative, formatSpan, formatStamp, formatWhen } from "@/lib/config";
import { FALLBACK, bondFor, parseGen, windowChoices, WINDOW_OPTIONS } from "@/lib/limits";

describe("formatStamp / formatDate", () => {
  it("renders an epoch as a readable UTC stamp", () => {
    expect(formatStamp(1_800_000_000)).toBe("15 Jan 2027, 08:00 UTC");
    // the live probe's deadline on the preliminary contract
    expect(formatStamp(1788616339)).toBe("5 Sep 2026, 13:52 UTC");
    expect(formatDate(1788616339)).toBe("5 Sep 2026");
  });
  it("names an unset epoch instead of printing zero", () => {
    expect(formatStamp(0)).toBe("not recorded");
    expect(formatDate(0)).toBe("not recorded");
    expect(formatWhen(0, 5)).toBe("not recorded");
  });
});

describe("formatRelative / formatWhen", () => {
  const now = 1_800_000_000;
  it("uses the largest honest unit in both directions", () => {
    expect(formatRelative(now + 30, now)).toBe("now");
    expect(formatRelative(now + 60, now)).toBe("in 1 minute");
    expect(formatRelative(now + 12 * 60, now)).toBe("in 12 minutes");
    expect(formatRelative(now - 3 * 3600, now)).toBe("3 hours ago");
    expect(formatRelative(now + 47 * 3600, now)).toBe("in 47 hours");
    expect(formatRelative(now + 2 * 86_400, now)).toBe("in 2 days");
    expect(formatRelative(now - 14 * 86_400, now)).toBe("14 days ago");
  });
  it("combines the stamp and the distance", () => {
    expect(formatWhen(now + 12 * 60, now)).toBe("15 Jan 2027, 08:12 UTC (in 12 minutes)");
  });
});

describe("formatSpan", () => {
  it("renders windows in whole human units", () => {
    expect(formatSpan(900)).toBe("15 minutes");
    expect(formatSpan(60)).toBe("1 minute");
    expect(formatSpan(45)).toBe("45 seconds");
    expect(formatSpan(3600)).toBe("1 hour");
    expect(formatSpan(7200)).toBe("2 hours");
    expect(formatSpan(86_400)).toBe("1 day");
    expect(formatSpan(1_209_600)).toBe("14 days");
    expect(formatSpan(2_592_000)).toBe("30 days");
  });
});

describe("formatGen", () => {
  it("shows three decimals from an atto string or bigint", () => {
    expect(formatGen("50000000000000000")).toBe("0.050");
    expect(formatGen(46_000_000_000_000_000n)).toBe("0.046");
    expect(formatGen("1000000000000000000000", 0)).toBe("1000");
    expect(formatGen("")).toBe("0.000");
  });
});

describe("limits — the drafting form's pure helpers", () => {
  it("parses GEN to atto exactly and refuses anything else", () => {
    expect(parseGen("0.05")).toBe(50_000_000_000_000_000n);
    expect(parseGen("1")).toBe(10n ** 18n);
    expect(parseGen(" 0.000000000000000001 ")).toBe(1n);
    expect(parseGen("0.0000000000000000001")).toBeNull();
    expect(parseGen("1e18")).toBeNull();
    expect(parseGen("-1")).toBeNull();
    expect(parseGen("")).toBeNull();
  });
  it("computes the bond as the contract does: 5 percent with a 0.05 GEN floor", () => {
    expect(bondFor(50_000_000_000_000_000n, FALLBACK)).toBe(50_000_000_000_000_000n);
    expect(bondFor(10n ** 18n, FALLBACK)).toBe(50_000_000_000_000_000n);
    expect(bondFor(2n * 10n ** 18n, FALLBACK)).toBe(100_000_000_000_000_000n);
  });
  it("offers the human window choices inside the bounds, plus the current value", () => {
    expect(windowChoices(86_400, FALLBACK.window_seconds)).toEqual([...WINDOW_OPTIONS]);
    expect(windowChoices(43_200, FALLBACK.window_seconds)).toContain(43_200);
    expect(windowChoices(86_400, [900, 3600])).toEqual([900, 3600, 86_400]);
    expect(windowChoices(0, FALLBACK.submission_grace_seconds)).toEqual([...WINDOW_OPTIONS]);
  });
});
