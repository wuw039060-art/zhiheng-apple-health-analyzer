import { describe, expect, it } from "vitest";
import { formatHealthMetric, formatHealthNumber } from "./format";

describe("human-readable health value formatting", () => {
  it("rounds energy, activity, and daylight values to whole human-readable units", () => {
    expect(formatHealthMetric("activeEnergyKcal", 512.3478291)).toBe("512 千卡");
    expect(formatHealthMetric("basalEnergyKcal", 1678.55551)).toBe("1,679 千卡");
    expect(formatHealthMetric("timeInDaylightMinutes", 37.6666)).toBe("38 分钟");
    expect(formatHealthMetric("steps", 12345.67)).toBe("12,346 步");
  });

  it("uses clinically sensible display precision for vital and fitness signals", () => {
    expect(formatHealthMetric("sleepHours", 7.4567)).toBe("7.5 小时");
    expect(formatHealthMetric("restingHeartRate", 59.666)).toBe("60 次/分");
    expect(formatHealthMetric("heartRateVariability", 48.333)).toBe("48 ms");
    expect(formatHealthMetric("respiratoryRate", 15.555)).toBe("15.6 次/分");
    expect(formatHealthMetric("oxygenSaturation", 97.555)).toBe("97.6%");
    expect(formatHealthMetric("wristTemperatureDelta", 0.12345)).toBe("+0.12°C");
    expect(formatHealthMetric("vo2Max", 43.287)).toBe("43.3 ml/kg/min");
    expect(formatHealthMetric("heartRateRecoveryOneMinute", 27.777)).toBe("28 次/分");
  });

  it("returns a number-only value for cards and a dash for missing or invalid data", () => {
    expect(formatHealthNumber("basalEnergyKcal", 1678.55551)).toBe("1,679");
    expect(formatHealthNumber("sleepHours", 7.4567)).toBe("7.5");
    expect(formatHealthMetric("oxygenSaturation", undefined)).toBe("—");
    expect(formatHealthMetric("oxygenSaturation", Number.NaN)).toBe("—");
  });
});
