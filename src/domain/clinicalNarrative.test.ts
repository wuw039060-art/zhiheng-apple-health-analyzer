import { describe, expect, it } from "vitest";
import { buildClinicalAdvice, buildTrendNarrative } from "./clinicalNarrative";
import { buildDailyReport } from "./dailyReport";
import type { DailyHealth } from "./types";

const day = (date: string, overrides: Partial<DailyHealth> = {}): DailyHealth => ({
  date, complete: true, highHeartRateEvents: 0, highHeartRateMinutes: 0,
  highEventsDuringWorkout: 0, lowHeartRateEvents: 0, lowHeartRateMinutes: 0,
  lowEventsDuringSleep: 0, irregularRhythmEvents: 0, ecgAbnormalCount: 0,
  coverage: [], sources: ["Apple Watch"], sampleCounts: {}, ...overrides,
});

describe("clinical narratives", () => {
  it("explains every sufficiently populated chart with evidence", () => {
    const days = Array.from({ length: 14 }, (_, index) => day(`2026-07-${String(index + 1).padStart(2, "0")}`, {
      restingHeartRate: index < 7 ? 60 : 66,
      heartRateVariability: index < 7 ? 62 : 50,
      sleepHours: index < 7 ? 8 : 6.5,
    }));
    const narrative = buildTrendNarrative(days, "restingHeartRate", "restingHeartRate", "静息心率");
    expect(narrative.tone).toBe("attention");
    expect(narrative.evidence.length).toBeGreaterThanOrEqual(4);
    expect(narrative.conclusion).not.toBe("");
  });

  it("prioritizes a heart-event review over lifestyle advice", () => {
    const baseline = Array.from({ length: 28 }, (_, index) => day(`2026-06-${String(index + 1).padStart(2, "0")}`, {
      restingHeartRate: 60, heartRateVariability: 60, respiratoryRate: 15,
      oxygenSaturation: 98, wristTemperatureDelta: 0, sleepHours: 8,
    }));
    const current = day("2026-07-01", {
      highHeartRateEvents: 2, restingHeartRate: 70, heartRateVariability: 45,
      respiratoryRate: 15, oxygenSaturation: 98, wristTemperatureDelta: 0, sleepHours: 6,
    });
    const report = buildDailyReport(current, [...baseline, current]);
    const advice = buildClinicalAdvice(current, [...baseline, current], report);
    expect(advice[0].category).toBe("心率与节律复核");
    expect(advice[0].reasoning.length).toBeGreaterThanOrEqual(3);
    expect(advice[0].seekCare).toContain("急救");
  });
});
