import { median, metricState } from "./analytics";
import type { DailyHealth } from "./types";

export type ReportTone = "stable" | "attention" | "limited";

export interface ReportFactor {
  label: string;
  detail: string;
  impact: number;
  tone: "positive" | "negative" | "neutral";
}

export interface StatusDimension {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: ReportTone;
}

export interface DailyReport {
  summary: string;
  nextAction: string;
  vitalityScore?: number;
  vitalityLabel: string;
  confidence: "较高" | "中等" | "有限";
  confidenceScore: number;
  factors: ReportFactor[];
  dimensions: StatusDimension[];
  sleepDebtHours?: number;
  lateNight: boolean;
  lateByMinutes?: number;
  dataQuality: {
    percent: number;
    present: number;
    expected: number;
    missing: string[];
    sampleCount: number;
    sources: string[];
  };
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedBedtime(minutes: number): number {
  return minutes < 12 * 60 ? minutes + 24 * 60 : minutes;
}

function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} 分钟`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

export function buildDailyReport(day: DailyHealth, allDays: DailyHealth[]): DailyReport {
  const sorted = allDays.filter((item) => item.complete).sort((a, b) => a.date.localeCompare(b.date));
  const prior = sorted.filter((item) => item.date < day.date);
  const baseline = prior.slice(-28);
  const rhr = metricState(day, baseline, "restingHeartRate");
  const hrv = metricState(day, baseline, "heartRateVariability");
  const respiratory = metricState(day, baseline, "respiratoryRate");
  const oxygen = metricState(day, baseline, "oxygenSaturation");
  const temperature = metricState(day, baseline, "wristTemperatureDelta");
  const sleep = metricState(day, baseline, "sleepHours");

  const required = [
    ["睡眠", day.sleepHours], ["静息心率", day.restingHeartRate], ["HRV", day.heartRateVariability],
    ["呼吸频率", day.respiratoryRate], ["血氧", day.oxygenSaturation], ["腕温", day.wristTemperatureDelta],
    ["活动能量", day.activeEnergyKcal], ["步数", day.steps], ["日照", day.timeInDaylightMinutes],
    ["心率", day.heartRateAverage], ["运动", day.exerciseMinutes], ["心肺适能", day.vo2Max],
  ] as const;
  const missing = required.filter(([, value]) => !hasNumber(value)).map(([label]) => label);
  const present = required.length - missing.length;
  const qualityPercent = Math.round((present / required.length) * 100);
  const sampleCount = Object.values(day.sampleCounts ?? {}).reduce((sum, count) => sum + count, 0);

  const factors: ReportFactor[] = [];
  let score = 72;
  if (hasNumber(day.sleepHours)) {
    const impact = clamp((day.sleepHours - 7.5) * 7, -18, 6);
    score += impact;
    factors.push({ label: "睡眠时长", detail: day.sleepHours < 7 ? "低于成年人通常建议的睡眠时长" : "睡眠时长接近恢复需要", impact: Math.round(impact), tone: impact < 0 ? "negative" : "positive" });
  }
  if (hrv.state === "low") { score -= 9; factors.push({ label: "HRV", detail: "低于个人 28 天稳健范围", impact: -9, tone: "negative" }); }
  else if (hrv.state === "high") { score += 5; factors.push({ label: "HRV", detail: "高于个人近期范围", impact: 5, tone: "positive" }); }
  if (rhr.state === "high") { score -= 8; factors.push({ label: "静息心率", detail: "高于个人 28 天稳健范围", impact: -8, tone: "negative" }); }
  else if (rhr.state === "low") { score += 4; factors.push({ label: "静息心率", detail: "低于个人近期范围，仍需结合症状理解", impact: 4, tone: "positive" }); }
  const vitalOutliers = [respiratory, oxygen, temperature].filter((state) => state.state === "high" || state.state === "low").length;
  if (vitalOutliers) { score -= vitalOutliers * 5; factors.push({ label: "夜间生命体征", detail: `${vitalOutliers} 项偏离个人近期范围`, impact: vitalOutliers * -5, tone: "negative" }); }
  if ((day.exerciseMinutes ?? 0) >= 30) { score += 4; factors.push({ label: "日常活动", detail: "当日锻炼达到 30 分钟", impact: 4, tone: "positive" }); }

  const bedtimeBaseline = median(baseline.map((item) => item.sleepStartMinutes).filter(hasNumber).map(normalizedBedtime));
  const bedtime = hasNumber(day.sleepStartMinutes) ? normalizedBedtime(day.sleepStartMinutes) : undefined;
  const lateByMinutes = bedtime !== undefined && bedtimeBaseline !== undefined ? bedtime - bedtimeBaseline : undefined;
  const lateNight = hasNumber(lateByMinutes) && lateByMinutes >= 60 && (day.sleepHours ?? 24) < 7.5;
  if (lateNight) {
    score -= 5;
    factors.push({ label: "作息后移", detail: `入睡比个人基线晚约 ${formatMinutes(lateByMinutes)}`, impact: -5, tone: "negative" });
  }

  const recentSeven = [...prior.slice(-6), day];
  const sleepDebtHours = recentSeven.some((item) => hasNumber(item.sleepHours))
    ? recentSeven.reduce((sum, item) => sum + (hasNumber(item.sleepHours) ? Math.max(0, 8 - item.sleepHours) : 0), 0)
    : undefined;
  const analysisSignals = [day.sleepHours, day.restingHeartRate, day.heartRateVariability, day.respiratoryRate, day.oxygenSaturation].filter(hasNumber).length;
  const confidenceScore = Math.round(clamp((baseline.length / 28) * 55 + (analysisSignals / 5) * 35 + (sampleCount > 20 ? 10 : sampleCount > 0 ? 5 : 0), 0, 100));
  const confidence = confidenceScore >= 80 ? "较高" : confidenceScore >= 55 ? "中等" : "有限";
  const vitalityScore = analysisSignals >= 3 ? Math.round(clamp(score, 0, 100)) : undefined;
  const vitalityLabel = vitalityScore === undefined ? "数据不足" : vitalityScore >= 80 ? "状态充足" : vitalityScore >= 65 ? "可以保持" : vitalityScore >= 50 ? "恢复一般" : "优先恢复";

  const negatives = factors.filter((item) => item.tone === "negative").sort((a, b) => a.impact - b.impact);
  const summary = vitalityScore === undefined
    ? "当前数据不足以形成可靠的每日状态判断。已保留可用读数，但不会用缺失数据补出分数。"
    : negatives.length
      ? `今天${vitalityLabel}。${negatives.slice(0, 2).map((item) => `${item.label}${item.detail}`).join("；")}。`
      : `今天${vitalityLabel}。睡眠、恢复和夜间生命体征未出现需要优先解释的组合偏离。`;
  const nextAction = negatives.some((item) => item.label === "睡眠时长" || item.label === "作息后移")
    ? "把最重要的任务安排在清醒度较高的时段，今晚优先恢复规律作息。"
    : negatives.some((item) => item.label === "HRV" || item.label === "静息心率")
      ? "今天先维持而不是加量；结合压力、训练、咖啡因和身体感受继续观察。"
      : "维持当前节奏，避免因为单日状态平稳而突然增加训练或工作负荷。";

  const dimensions: StatusDimension[] = [
    { id: "vitality", label: "身体活力", value: vitalityScore === undefined ? "—" : `${vitalityScore}`, detail: "产品推导指标，可展开查看贡献", tone: vitalityScore === undefined ? "limited" : vitalityScore < 65 ? "attention" : "stable" },
    { id: "sleep", label: "睡眠恢复", value: hasNumber(day.sleepHours) ? `${day.sleepHours.toFixed(1)} 小时` : "—", detail: sleep.state === "low" ? "低于个人范围" : sleep.state === "high" ? "高于个人范围" : baseline.length >= 7 ? "个人范围内" : "基线建立中", tone: !hasNumber(day.sleepHours) ? "limited" : day.sleepHours < 7 ? "attention" : "stable" },
    { id: "cardio", label: "心血管恢复", value: hasNumber(day.heartRateVariability) ? `HRV ${Math.round(day.heartRateVariability)} ms` : "—", detail: rhr.state === "high" || hrv.state === "low" ? "恢复信号值得观察" : baseline.length >= 7 ? "近期范围内" : "基线建立中", tone: rhr.state === "high" || hrv.state === "low" ? "attention" : analysisSignals < 3 ? "limited" : "stable" },
    { id: "activity", label: "活动负荷", value: hasNumber(day.steps) ? `${Math.round(day.steps).toLocaleString("zh-CN")} 步` : "—", detail: hasNumber(day.exerciseMinutes) ? `${Math.round(day.exerciseMinutes)} 分钟锻炼` : "缺少锻炼记录", tone: hasNumber(day.steps) || hasNumber(day.exerciseMinutes) ? "stable" : "limited" },
    { id: "vitals", label: "生命体征稳定性", value: vitalOutliers ? `${vitalOutliers} 项偏离` : analysisSignals >= 3 ? "稳定" : "—", detail: vitalOutliers ? "只表示相对个人范围变化" : "未发现多指标同步偏离", tone: vitalOutliers ? "attention" : analysisSignals < 3 ? "limited" : "stable" },
    { id: "quality", label: "数据可信度", value: `${qualityPercent}%`, detail: `${present}/${required.length} 项核心指标 · ${sampleCount.toLocaleString("zh-CN")} 条样本`, tone: qualityPercent >= 70 ? "stable" : qualityPercent >= 40 ? "attention" : "limited" },
  ];

  return {
    summary, nextAction, vitalityScore, vitalityLabel, confidence, confidenceScore,
    factors: factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)), dimensions,
    sleepDebtHours, lateNight, lateByMinutes: lateNight ? lateByMinutes : undefined,
    dataQuality: { percent: qualityPercent, present, expected: required.length, missing, sampleCount, sources: day.sources ?? [] },
  };
}
