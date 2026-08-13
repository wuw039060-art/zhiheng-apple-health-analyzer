import { describe, expect, it } from "vitest";
import { deriveHealthInsights, median, metricState } from "./analytics";
import type { DailyHealth } from "./types";

const day = (date: string, overrides: Partial<DailyHealth> = {}): DailyHealth => ({
  date,
  complete: true,
  restingHeartRate: 60,
  heartRateVariability: 60,
  respiratoryRate: 15,
  oxygenSaturation: 97,
  wristTemperatureDelta: 0,
  sleepHours: 7.5,
  exerciseMinutes: 35,
  highHeartRateEvents: 0,
  highHeartRateMinutes: 0,
  highEventsDuringWorkout: 0,
  lowHeartRateEvents: 0,
  lowHeartRateMinutes: 0,
  lowEventsDuringSleep: 0,
  irregularRhythmEvents: 0,
  ecgAbnormalCount: 0,
  coverage: [],
  ...overrides,
});

const baseline = Array.from({ length: 28 }, (_, index) =>
  day(`2026-06-${String(index + 1).padStart(2, "0")}`, {
    restingHeartRate: 60 + (index % 3) - 1,
    heartRateVariability: 60 + (index % 5) - 2,
    respiratoryRate: 15 + ((index % 3) - 1) * 0.2,
    oxygenSaturation: 97 + ((index % 3) - 1) * 0.2,
  }),
);

describe("robust health analytics", () => {
  it("calculates a median without being distorted by one extreme value", () => {
    expect(median([1, 2, 2, 3, 999])).toBe(2);
  });

  it("requires seven baseline days before classifying a personal outlier", () => {
    const current = day("2026-07-01", { restingHeartRate: 90 });
    expect(metricState(current, baseline.slice(0, 6), "restingHeartRate").state).toBe("unknown");
    expect(metricState(current, baseline, "restingHeartRate").state).toBe("high");
  });

  it("raises a stronger high-heart-rate insight when oxygen and breathing also deviate", () => {
    const current = day("2026-07-01", {
      highHeartRateEvents: 2,
      highHeartRateMinutes: 20,
      oxygenSaturation: 92,
      respiratoryRate: 20,
    });
    const insight = deriveHealthInsights([...baseline, current], 7).find(
      (item) => item.id === "high-heart-rate-cross-check",
    );
    expect(insight?.severity).toBe("important");
    expect(insight?.explanations[0].title).toContain("呼吸");
  });

  it("cross-checks a heart event against its own day instead of the latest day", () => {
    const eventDay = day("2026-07-01", {
      highHeartRateEvents: 1,
      highHeartRateMinutes: 10,
      oxygenSaturation: 92,
      respiratoryRate: 20,
    });
    const normalLatestDay = day("2026-07-02");
    const insight = deriveHealthInsights([...baseline, eventDay, normalLatestDay], 7).find(
      (item) => item.id === "high-heart-rate-cross-check",
    );
    expect(insight?.severity).toBe("important");
    expect(insight?.evidence.some((item) => item.label.startsWith("2026-07-01"))).toBe(true);
  });

  it("creates a dated card when multiple vitals deviate on a prior day", () => {
    const anomalyDay = day("2026-07-01", { wristTemperatureDelta: 1.2, restingHeartRate: 82 });
    const normalLatestDay = day("2026-07-02");
    const insights = deriveHealthInsights([...baseline, anomalyDay, normalLatestDay], 7);
    expect(insights.some((item) => item.id === "multi-vital-outlier-2026-07-01")).toBe(true);
  });

  it("adds same-day ECG classification as supporting context without calling it a diagnosis", () => {
    const eventDay = day("2026-07-01", { highHeartRateEvents: 1, ecgAbnormalCount: 1 });
    const insight = deriveHealthInsights([...baseline, eventDay], 7).find(
      (item) => item.id === "high-heart-rate-cross-check",
    );
    expect(insight?.evidence.some((item) => item.label.includes("ECG"))).toBe(true);
    expect(insight?.explanations.some((item) => item.title.includes("心律"))).toBe(true);
  });

  it("treats sleep-clustered low-heart-rate events differently when other vitals are stable", () => {
    const current = day("2026-07-01", {
      lowHeartRateEvents: 5,
      lowHeartRateMinutes: 50,
      lowEventsDuringSleep: 5,
    });
    const insight = deriveHealthInsights([...baseline, current], 7).find(
      (item) => item.id === "low-heart-rate-cross-check",
    );
    expect(insight?.severity).toBe("notice");
    expect(insight?.explanations[0].title).toContain("睡眠期");
  });
});
