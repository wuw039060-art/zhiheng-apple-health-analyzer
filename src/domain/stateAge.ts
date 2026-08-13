import { median, metricState } from "./analytics";
import type {
  BiologicalSex,
  DailyHealth,
  ProfileContext,
  StateAgeComponent,
  StateAgeResult,
} from "./types";
import { formatHealthMetric } from "./format";

const MODEL_VERSION = "state-age-1.0.0";
const APPLE_VO2_TYPICAL_ERROR = 4.7;

// FRIEND Registry treadmill medians. Ages are decade midpoints, not individual diagnoses.
const FRIEND_MEDIANS: Record<"male" | "female", Array<[number, number]>> = {
  male: [
    [24.5, 46.5], [34.5, 39.7], [44.5, 35.3], [54.5, 29.2],
    [64.5, 24.6], [74.5, 20.6], [84.5, 17.6],
  ],
  female: [
    [24.5, 36.6], [34.5, 28.3], [44.5, 25.7], [54.5, 22.9],
    [64.5, 19.6], [74.5, 17.2], [84.5, 15.4],
  ],
};

const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function completeSorted(days: DailyHealth[]): DailyHealth[] {
  return days.filter((day) => day.complete).sort((a, b) => a.date.localeCompare(b.date));
}

function values(days: DailyHealth[], key: keyof DailyHealth): number[] {
  return days.map((day) => day[key]).filter(validNumber);
}

function mean(input: number[]): number | undefined {
  return input.length ? input.reduce((sum, value) => sum + value, 0) / input.length : undefined;
}

function asSex(value?: BiologicalSex): "male" | "female" | undefined {
  return value === "male" || value === "female" ? value : undefined;
}

export function estimateCardioFitnessAge(vo2Max: number, sex: "male" | "female"): number {
  const points = FRIEND_MEDIANS[sex];
  if (vo2Max >= points[0][1]) return 20;
  if (vo2Max <= points.at(-1)![1]) return 89;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [youngerAge, youngerVo2] = points[index];
    const [olderAge, olderVo2] = points[index + 1];
    if (vo2Max <= youngerVo2 && vo2Max >= olderVo2) {
      const fraction = (youngerVo2 - vo2Max) / (youngerVo2 - olderVo2);
      return youngerAge + fraction * (olderAge - youngerAge);
    }
  }
  return 89;
}

function activityComponent(window: DailyHealth[]): StateAgeComponent {
  const exercise = mean(values(window, "exerciseMinutes"));
  const steps = mean(values(window, "steps"));
  const weeklyExercise = (exercise ?? 0) * 7;
  let adjustment = weeklyExercise >= 300 ? -1 : weeklyExercise >= 150 ? -0.5 : weeklyExercise < 75 ? 0.8 : 0;
  if (validNumber(steps)) adjustment += steps >= 10_000 ? -0.3 : steps >= 7_000 ? -0.1 : steps < 5_000 ? 0.4 : 0;
  adjustment = clamp(adjustment, -1.2, 1.2);
  const score = clamp((weeklyExercise / 300) * 80 + Math.min((steps ?? 0) / 10_000, 1) * 20, 0, 100);
  return {
    id: "activity",
    label: "活动与运动",
    role: "modifier",
    value: `${formatHealthMetric("exerciseMinutes", weeklyExercise)}/周 · ${steps === undefined ? "步数缺失" : `${formatHealthMetric("steps", steps)}/日`}`,
    score: round(score),
    yearAdjustment: round(adjustment),
    coverage: `锻炼 ${values(window, "exerciseMinutes").length}/${window.length} 天 · 步数 ${values(window, "steps").length}/${window.length} 天`,
    freshness: window.at(-1)?.date ?? "未知",
    explanation: "依据成人每周 150–300 分钟中等强度活动建议做小幅行为修正；为避免与 VO₂ max 重复计分，修正封顶 ±1.2 岁。",
    sourceIds: ["cdc-activity-guidelines"],
  };
}

function sleepComponent(window: DailyHealth[]): StateAgeComponent {
  const sleep = values(window, "sleepHours");
  const average = mean(sleep);
  const shortNights = sleep.filter((hours) => hours < 7).length;
  let adjustment = 0;
  if (average !== undefined && average < 7) {
    adjustment = clamp((7 - average) * 1.4, 0, 2);
  } else if (average !== undefined && average > 9.5) {
    adjustment = 0.3;
  }
  return {
    id: "sleep",
    label: "睡眠恢复",
    role: "modifier",
    value: average === undefined ? "数据不足" : `${formatHealthMetric("sleepHours", average)}/夜 · ${shortNights}/${sleep.length} 夜少于 7 小时`,
    score: average === undefined ? undefined : round(clamp(100 - Math.abs(8 - average) * 22, 0, 100)),
    yearAdjustment: round(adjustment),
    coverage: `${sleep.length}/${window.length} 夜`,
    freshness: window.filter((day) => validNumber(day.sleepHours)).at(-1)?.date ?? "未知",
    explanation: "短期睡眠不足反映当前恢复负担，只作有限状态修正；它不是寿命或器官年龄换算。",
    sourceIds: ["cdc-sleep-duration"],
  };
}

function recoveryComponent(allDays: DailyHealth[], endDate: string): StateAgeComponent {
  const cutoff = new Date(`${endDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 60);
  const recent = allDays.filter((day) => day.date >= cutoff.toISOString().slice(0, 10) && day.date <= endDate);
  const samples = values(recent, "heartRateRecoveryOneMinute");
  const center = median(samples);
  let adjustment = 0;
  if (samples.length >= 3 && center !== undefined) {
    adjustment = center > 30 ? -0.5 : center >= 20 ? -0.2 : center > 12 ? 0.3 : 0.8;
  }
  return {
    id: "heart-rate-recovery",
    label: "一分钟心率恢复",
    role: "modifier",
    value: center === undefined ? "近 60 天无数据" : formatHealthMetric("heartRateRecoveryOneMinute", center),
    score: center === undefined ? undefined : round(clamp((center / 35) * 100, 0, 100)),
    yearAdjustment: round(adjustment),
    coverage: `${samples.length} 个近 60 天样本（至少 3 个才参与修正）`,
    freshness: recent.filter((day) => validNumber(day.heartRateRecoveryOneMinute)).at(-1)?.date ?? "已过期",
    explanation: samples.length < 3
      ? "恢复数据不足或过期，本项不改变年龄，只降低模型把握度。"
      : "运动方案会影响心率恢复，研究阈值不能直接套用于所有 Apple Watch 训练，因此只做小幅修正。",
    sourceIds: ["apple-heart-rate-recovery", "cole-heart-rate-recovery"],
  };
}

function autonomicComponent(allDays: DailyHealth[], window: DailyHealth[]): StateAgeComponent {
  const end = window.at(-1)?.date ?? "";
  const current = window.slice(-14);
  const prior = completeSorted(allDays).filter((day) => day.date < current[0]?.date && day.date <= end).slice(-28);
  const currentRhr = median(values(current, "restingHeartRate"));
  const priorRhr = median(values(prior, "restingHeartRate"));
  const currentHrv = median(values(current, "heartRateVariability"));
  const priorHrv = median(values(prior, "heartRateVariability"));
  let adjustment = 0;
  const enough = values(current, "restingHeartRate").length >= 7 && values(current, "heartRateVariability").length >= 7
    && values(prior, "restingHeartRate").length >= 7 && values(prior, "heartRateVariability").length >= 7;
  if (enough && currentRhr !== undefined && priorRhr !== undefined && currentHrv !== undefined && priorHrv !== undefined) {
    const rhrHigher = currentRhr > priorRhr + Math.max(5, priorRhr * 0.1);
    const rhrLower = currentRhr < priorRhr - Math.max(5, priorRhr * 0.1);
    const hrvLower = currentHrv < priorHrv - Math.max(7, priorHrv * 0.15);
    const hrvHigher = currentHrv > priorHrv + Math.max(7, priorHrv * 0.15);
    adjustment = rhrHigher && hrvLower ? 0.8 : rhrLower && hrvHigher ? -0.5 : rhrHigher || hrvLower ? 0.25 : rhrLower || hrvHigher ? -0.25 : 0;
  }
  return {
    id: "autonomic-recovery",
    label: "静息心率与 HRV",
    role: "modifier",
    value: `${formatHealthMetric("restingHeartRate", currentRhr)} · ${formatHealthMetric("heartRateVariability", currentHrv)}`,
    score: undefined,
    yearAdjustment: round(adjustment),
    coverage: `近 14 天 RHR ${values(current, "restingHeartRate").length} 天 · HRV ${values(current, "heartRateVariability").length} 天`,
    freshness: end || "未知",
    explanation: "Apple Watch 的短时 SDNN 与 24 小时动态心电图规范并不等价，因此不单独换算人群年龄，只判断相对自身 28 天基线的恢复方向。",
    sourceIds: ["apple-watch-hrv-validation", "wearable-rhr-population"],
  };
}

function vitalStabilityComponent(allDays: DailyHealth[], window: DailyHealth[]): StateAgeComponent {
  let multiVitalDays = 0;
  for (const day of window.slice(-14)) {
    const baseline = completeSorted(allDays).filter((item) => item.date < day.date).slice(-28);
    const states = [
      metricState(day, baseline, "oxygenSaturation"),
      metricState(day, baseline, "wristTemperatureDelta"),
      metricState(day, baseline, "respiratoryRate"),
    ];
    if (states.filter((item) => item.state === "high" || item.state === "low").length >= 2) multiVitalDays += 1;
  }
  return {
    id: "vital-stability",
    label: "血氧、呼吸与腕温稳定性",
    role: "modifier",
    value: `近 14 天 ${multiVitalDays} 天出现两项以上同步偏离`,
    score: round(clamp(100 - multiVitalDays * 18, 0, 100)),
    yearAdjustment: multiVitalDays >= 3 ? 0.5 : 0,
    coverage: `血氧 ${values(window, "oxygenSaturation").length} 天 · 腕温 ${values(window, "wristTemperatureDelta").length} 天`,
    freshness: window.at(-1)?.date ?? "未知",
    explanation: "血氧和腕温没有经过验证的年龄换算公式；只有重复、多指标同步偏离时才做很小的状态修正，并交给警示模块解释原因。",
    sourceIds: ["apple-vitals", "apple-blood-oxygen"],
  };
}

function contextComponents(window: DailyHealth[]): StateAgeComponent[] {
  const active = mean(values(window, "activeEnergyKcal"));
  const basal = mean(values(window, "basalEnergyKcal"));
  const daylight = mean(values(window, "timeInDaylightMinutes"));
  return [
    {
      id: "energy-context", label: "活动能量与静息能量", role: "context-only",
      value: `${active === undefined ? "—" : `${formatHealthMetric("activeEnergyKcal", active)} 活动`} · ${basal === undefined ? "—" : `${formatHealthMetric("basalEnergyKcal", basal)} 静息`}`,
      yearAdjustment: 0,
      coverage: `活动 ${values(window, "activeEnergyKcal").length}/${window.length} 天 · 静息 ${values(window, "basalEnergyKcal").length}/${window.length} 天`,
      freshness: window.at(-1)?.date ?? "未知",
      explanation: "能量消耗受体重、设备佩戴和算法影响，用于解释活动负荷，不直接换算年龄。",
      sourceIds: ["apple-active-energy"],
    },
    {
      id: "daylight-context", label: "日照时间", role: "context-only",
      value: daylight === undefined ? "—" : `${formatHealthMetric("timeInDaylightMinutes", daylight)}/日`,
      yearAdjustment: 0,
      coverage: `${values(window, "timeInDaylightMinutes").length}/${window.length} 天`,
      freshness: window.filter((day) => validNumber(day.timeInDaylightMinutes)).at(-1)?.date ?? "未知",
      explanation: "日照可作为作息和户外活动背景，但当前没有可靠的“日照分钟数→年龄”换算，因此不加减年龄。",
      sourceIds: ["apple-time-in-daylight"],
    },
  ];
}

export function calculateStateAge(days: DailyHealth[], profile?: ProfileContext): StateAgeResult {
  const complete = completeSorted(days);
  const window = complete.slice(-30);
  const sex = asSex(profile?.biologicalSex);
  const chronologicalAge = profile?.chronologicalAgeYears;
  const vo2Samples = values(window, "vo2Max");
  const vo2 = median(vo2Samples);
  const missing: string[] = [];
  if (!sex) missing.push("生理性别（FRIEND 参考曲线需要）");
  if (!validNumber(chronologicalAge)) missing.push("当前年龄");
  if (vo2Samples.length < 3 || vo2 === undefined) missing.push("近 30 天至少 3 个 VO₂ max 样本");
  if (window.length < 14) missing.push("至少 14 个完整日");

  const disclaimer = "状态年龄是基于人群参考曲线和近期可穿戴数据的非医疗估算，不是生物学年龄、寿命预测或疾病诊断；0.1 岁只是计算显示分辨率。";
  if (missing.length || !sex || vo2 === undefined) {
    return {
      status: "insufficient-data", confidence: "有限", confidenceScore: 0,
      modelVersion: MODEL_VERSION, missing, components: [], sourceIds: ["friend-vo2-reference", "apple-cardio-fitness-whitepaper"], disclaimer,
    };
  }

  const cardioAge = estimateCardioFitnessAge(vo2, sex);
  const anchor: StateAgeComponent = {
    id: "cardio-fitness", label: "心肺适能年龄", role: "age-anchor",
    value: `VO₂ max ${formatHealthMetric("vo2Max", vo2)}`, ageEquivalent: round(cardioAge), yearAdjustment: 0,
    score: round(clamp(100 - ((cardioAge - 20) / 69) * 100, 0, 100)),
    coverage: `${vo2Samples.length}/${window.length} 天`,
    freshness: window.filter((day) => validNumber(day.vo2Max)).at(-1)?.date ?? "未知",
    explanation: "用 FRIEND Registry 同性别人群分年龄段中位数做分段插值。Apple Watch 的 VO₂ max 是估计值，不能等同于实验室心肺运动试验。",
    sourceIds: ["friend-vo2-reference", "apple-cardio-fitness-whitepaper"],
  };
  const components = [
    anchor,
    activityComponent(window),
    sleepComponent(window),
    recoveryComponent(complete, window.at(-1)!.date),
    autonomicComponent(complete, window),
    vitalStabilityComponent(complete, window),
    ...contextComponents(window),
  ];
  const modifier = clamp(
    components.filter((item) => item.role === "modifier").reduce((sum, item) => sum + item.yearAdjustment, 0),
    -3,
    3,
  );
  const age = clamp(cardioAge + modifier, 20, 89);
  const lowerCardio = estimateCardioFitnessAge(vo2 + APPLE_VO2_TYPICAL_ERROR, sex);
  const upperCardio = estimateCardioFitnessAge(Math.max(1, vo2 - APPLE_VO2_TYPICAL_ERROR), sex);
  const recovery = components.find((item) => item.id === "heart-rate-recovery")!;
  const coveragePenalty = recovery.freshness === "已过期" ? 1 : 0.5;
  const lower = clamp(lowerCardio + modifier - coveragePenalty, 20, 89);
  const upper = clamp(upperCardio + modifier + coveragePenalty, 20, 89);

  let confidenceScore = 35;
  confidenceScore += Math.min(vo2Samples.length / 15, 1) * 20;
  confidenceScore += Math.min(window.length / 30, 1) * 12;
  confidenceScore += Math.min(values(window, "sleepHours").length / 25, 1) * 8;
  confidenceScore += Math.min(values(window, "restingHeartRate").length / 20, 1) * 5;
  confidenceScore += Math.min(values(window, "oxygenSaturation").length / 20, 1) * 5;
  confidenceScore += recovery.freshness === "已过期" ? 0 : 5;
  confidenceScore = round(clamp(confidenceScore, 0, 100), 0);
  // Without current post-exercise recovery data, the composite cannot be labelled high-confidence.
  if (recovery.freshness === "已过期") confidenceScore = Math.min(confidenceScore, 79);
  const confidence = confidenceScore >= 80 ? "较高" : confidenceScore >= 60 ? "中等" : "有限";
  const sourceIds = [...new Set(components.flatMap((item) => item.sourceIds))];
  const primaryReason = components
    .filter((item) => item.role === "modifier" && item.yearAdjustment !== 0)
    .sort((a, b) => Math.abs(b.yearAdjustment) - Math.abs(a.yearAdjustment))[0]?.label;

  return {
    status: "available", age: round(age), lower: round(Math.min(lower, age)), upper: round(Math.max(upper, age)),
    chronologicalAge: validNumber(chronologicalAge) ? round(chronologicalAge) : undefined,
    difference: validNumber(chronologicalAge) ? round(age - chronologicalAge) : undefined,
    confidence, confidenceScore, modelVersion: MODEL_VERSION,
    periodStart: window[0]?.date, periodEnd: window.at(-1)?.date, primaryReason, missing: [], components, sourceIds, disclaimer,
  };
}
