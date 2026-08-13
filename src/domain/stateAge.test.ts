import { describe, expect, it } from "vitest";
import { calculateStateAge, estimateCardioFitnessAge } from "./stateAge";
import type { DailyHealth } from "./types";

function day(index: number, overrides: Partial<DailyHealth> = {}): DailyHealth {
  const date = new Date("2026-06-01T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + index);
  return {
    date: date.toISOString().slice(0, 10), complete: true,
    sleepHours: 8, restingHeartRate: 60, heartRateVariability: 65,
    oxygenSaturation: 97, respiratoryRate: 15, wristTemperatureDelta: 0,
    activeEnergyKcal: 500, basalEnergyKcal: 1650, exerciseMinutes: 30,
    steps: 9000, timeInDaylightMinutes: 90, vo2Max: 42.86,
    highHeartRateEvents: 0, highHeartRateMinutes: 0, highEventsDuringWorkout: 0,
    lowHeartRateEvents: 0, lowHeartRateMinutes: 0, lowEventsDuringSleep: 0,
    irregularRhythmEvents: 0, ecgAbnormalCount: 0, coverage: [], ...overrides,
  };
}

describe("状态年龄模型", () => {
  it("按 FRIEND 男性中位曲线插值得到约 29.9 岁心肺年龄", () => {
    expect(estimateCardioFitnessAge(42.86, "male")).toBeCloseTo(29.9, 1);
  });

  it("结果固定显示到一位小数且区间包含点估计", () => {
    const result = calculateStateAge(Array.from({ length: 30 }, (_, index) => day(index)), {
      chronologicalAgeYears: 20, biologicalSex: "male", measuredAt: "2026-06-30",
    });
    expect(result.status).toBe("available");
    expect(result.age).toBe(Number(result.age!.toFixed(1)));
    expect(result.lower).toBeLessThanOrEqual(result.age!);
    expect(result.upper).toBeGreaterThanOrEqual(result.age!);
  });

  it("缺少 VO2 max 时拒绝生成年龄", () => {
    const result = calculateStateAge(Array.from({ length: 30 }, (_, index) => day(index, { vo2Max: undefined })), {
      chronologicalAgeYears: 20, biologicalSex: "male",
    });
    expect(result.status).toBe("insufficient-data");
    expect(result.missing.join(" ")).toContain("VO₂ max");
  });

  it("日照和能量仅作背景，不直接改变年龄", () => {
    const base = Array.from({ length: 30 }, (_, index) => day(index));
    const changed = base.map((item) => ({ ...item, timeInDaylightMinutes: 5, activeEnergyKcal: 50, basalEnergyKcal: 2500 }));
    const profile = { chronologicalAgeYears: 20, biologicalSex: "male" as const };
    expect(calculateStateAge(changed, profile).age).toBe(calculateStateAge(base, profile).age);
  });

  it("睡眠不足会增加状态修正且运动修正受封顶保护", () => {
    const days = Array.from({ length: 30 }, (_, index) => day(index, { sleepHours: 5.9, exerciseMinutes: 120, steps: 30_000 }));
    const result = calculateStateAge(days, { chronologicalAgeYears: 20, biologicalSex: "male" });
    const sleep = result.components.find((item) => item.id === "sleep")!;
    const activity = result.components.find((item) => item.id === "activity")!;
    expect(sleep.yearAdjustment).toBeGreaterThan(0);
    expect(activity.yearAdjustment).toBe(-1.2);
  });

  it("复现当前导出近 30 天的可解释估算", () => {
    const current = Array.from({ length: 30 }, (_, index) => day(index, {
      sleepHours: index === 0 ? undefined : 5.886,
      restingHeartRate: 70.967,
      heartRateVariability: 64.34,
      oxygenSaturation: 95.2,
      activeEnergyKcal: 466.949,
      basalEnergyKcal: 1624.343,
      exerciseMinutes: 44.067,
      steps: 18_820.6,
      timeInDaylightMinutes: 121.467,
      vo2Max: index % 2 === 0 ? 42.86 : undefined,
    }));
    const result = calculateStateAge(current, { chronologicalAgeYears: 20, biologicalSex: "male" });
    expect(result.age).toBe(30.3);
    expect(result.confidence).toBe("中等");
    expect(result.lower).toBe(20);
    expect(result.upper).toBeCloseTo(39.4, 1);
  });
});
