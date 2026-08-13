import { describe, expect, it } from "vitest";
import { buildDailyReport } from "./dailyReport";
import type { DailyHealth } from "./types";

const day = (date: string, overrides: Partial<DailyHealth> = {}): DailyHealth => ({
  date, complete: true, highHeartRateEvents: 0, highHeartRateMinutes: 0,
  highEventsDuringWorkout: 0, lowHeartRateEvents: 0, lowHeartRateMinutes: 0,
  lowEventsDuringSleep: 0, irregularRhythmEvents: 0, ecgAbnormalCount: 0,
  coverage: [], sources: ["Apple Watch"], sampleCounts: { heart: 20 }, ...overrides,
});

describe("daily deterministic report", () => {
  it("does not invent a vitality score when core data is sparse", () => {
    const report = buildDailyReport(day("2026-07-18", { steps: 8000 }), []);
    expect(report.vitalityScore).toBeUndefined();
    expect(report.summary).toContain("数据不足");
  });

  it("flags a late short night relative to the user's own bedtime baseline", () => {
    const baseline = Array.from({ length: 28 }, (_, index) => day(`2026-06-${String(index + 1).padStart(2, "0")}`, {
      sleepStartMinutes: 23 * 60, sleepHours: 8, restingHeartRate: 60, heartRateVariability: 60,
      respiratoryRate: 15, oxygenSaturation: 98,
    }));
    const current = day("2026-07-01", {
      sleepStartMinutes: 30, sleepHours: 6, restingHeartRate: 70, heartRateVariability: 40,
      respiratoryRate: 15, oxygenSaturation: 98,
    });
    const report = buildDailyReport(current, [...baseline, current]);
    expect(report.lateNight).toBe(true);
    expect(report.lateByMinutes).toBe(90);
    expect(report.factors.some((factor) => factor.label === "作息后移")).toBe(true);
  });
});
