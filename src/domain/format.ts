export type HealthDisplayMetric =
  | "sleepHours"
  | "awakeMinutes"
  | "sleepEfficiencyPercentage"
  | "heartRateAverage"
  | "heartRateMinimum"
  | "heartRateMaximum"
  | "restingHeartRate"
  | "walkingHeartRateAverage"
  | "heartRateVariability"
  | "respiratoryRate"
  | "oxygenSaturation"
  | "wristTemperatureDelta"
  | "vo2Max"
  | "heartRateRecoveryOneMinute"
  | "activeEnergyKcal"
  | "basalEnergyKcal"
  | "exerciseMinutes"
  | "workoutMinutes"
  | "steps"
  | "walkingRunningDistanceKm"
  | "standMinutes"
  | "flightsClimbed"
  | "walkingSpeed"
  | "walkingStepLengthCm"
  | "walkingAsymmetryPercentage"
  | "walkingDoubleSupportPercentage"
  | "stairAscentSpeed"
  | "stairDescentSpeed"
  | "timeInDaylightMinutes";

interface DisplaySpec {
  digits: number;
  unit: string;
  showSign?: boolean;
}

const DISPLAY_SPECS: Record<HealthDisplayMetric, DisplaySpec> = {
  sleepHours: { digits: 1, unit: "小时" },
  awakeMinutes: { digits: 0, unit: "分钟" },
  sleepEfficiencyPercentage: { digits: 0, unit: "%" },
  heartRateAverage: { digits: 0, unit: "次/分" },
  heartRateMinimum: { digits: 0, unit: "次/分" },
  heartRateMaximum: { digits: 0, unit: "次/分" },
  restingHeartRate: { digits: 0, unit: "次/分" },
  walkingHeartRateAverage: { digits: 0, unit: "次/分" },
  heartRateVariability: { digits: 0, unit: "ms" },
  respiratoryRate: { digits: 1, unit: "次/分" },
  oxygenSaturation: { digits: 1, unit: "%" },
  wristTemperatureDelta: { digits: 2, unit: "°C", showSign: true },
  vo2Max: { digits: 1, unit: "ml/kg/min" },
  heartRateRecoveryOneMinute: { digits: 0, unit: "次/分" },
  activeEnergyKcal: { digits: 0, unit: "千卡" },
  basalEnergyKcal: { digits: 0, unit: "千卡" },
  exerciseMinutes: { digits: 0, unit: "分钟" },
  workoutMinutes: { digits: 0, unit: "分钟" },
  steps: { digits: 0, unit: "步" },
  walkingRunningDistanceKm: { digits: 1, unit: "公里" },
  standMinutes: { digits: 0, unit: "分钟" },
  flightsClimbed: { digits: 0, unit: "层" },
  walkingSpeed: { digits: 2, unit: "公里/小时" },
  walkingStepLengthCm: { digits: 1, unit: "厘米" },
  walkingAsymmetryPercentage: { digits: 1, unit: "%" },
  walkingDoubleSupportPercentage: { digits: 1, unit: "%" },
  stairAscentSpeed: { digits: 2, unit: "米/秒" },
  stairDescentSpeed: { digits: 2, unit: "米/秒" },
  timeInDaylightMinutes: { digits: 0, unit: "分钟" },
};

export function formatHealthNumber(
  metric: HealthDisplayMetric,
  value: unknown,
  options: { forceSign?: boolean } = {},
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const spec = DISPLAY_SPECS[metric];
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: spec.digits,
    maximumFractionDigits: spec.digits,
    useGrouping: true,
    signDisplay: options.forceSign || spec.showSign ? "exceptZero" : "auto",
  }).format(value);
}

export function formatHealthMetric(metric: HealthDisplayMetric, value: unknown): string {
  const formatted = formatHealthNumber(metric, value);
  if (formatted === "—") return formatted;
  const unit = DISPLAY_SPECS[metric].unit;
  return unit === "%" || unit === "°C" ? `${formatted}${unit}` : `${formatted} ${unit}`;
}
