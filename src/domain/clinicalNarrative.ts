import { median, metricState } from "./analytics";
import type { DailyReport } from "./dailyReport";
import { formatHealthMetric, formatHealthNumber, type HealthDisplayMetric } from "./format";
import type { DailyHealth } from "./types";

export type NarrativeTone = "stable" | "attention" | "limited";

export interface SectionNarrative {
  title: string;
  conclusion: string;
  evidence: string[];
  interpretation: string;
  action: string;
  tone: NarrativeTone;
  confidence: "较高" | "中等" | "有限";
}

export interface TrendNarrative extends SectionNarrative {
  sampleCount: number;
  latest: string;
  windowMedian: string;
  range: string;
}

export interface ClinicalAdviceItem {
  rank: number;
  category: string;
  title: string;
  clinicalSummary: string;
  observations: string[];
  reasoning: Array<{ label: string; text: string }>;
  plan: Array<{ when: string; action: string }>;
  monitor: string[];
  reviewAfter: string;
  stop: string;
  seekCare: string;
  sourceIds: string[];
  grade: "A" | "B";
  tone: NarrativeTone;
}

type TrendKey = "restingHeartRate" | "heartRateVariability" | "sleepHours" | "activeEnergyKcal";

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const baselineBefore = (day: DailyHealth, history: DailyHealth[]) => history.filter((item) => item.complete && item.date < day.date).slice(-28);

function confidence(days: number): "较高" | "中等" | "有限" {
  return days >= 21 ? "较高" : days >= 8 ? "中等" : "有限";
}

const stateText = (state: "high" | "low" | "typical" | "unknown") => state === "high" ? "高于个人范围" : state === "low" ? "低于个人范围" : state === "typical" ? "个人范围内" : "基线不足";

export function buildSectionNarrative(
  section: "sleep" | "recovery" | "activity" | "vitals",
  day: DailyHealth,
  history: DailyHealth[],
  report: DailyReport,
): SectionNarrative {
  const baseline = baselineBefore(day, history);
  const rhr = metricState(day, baseline, "restingHeartRate");
  const hrv = metricState(day, baseline, "heartRateVariability");
  const oxygen = metricState(day, baseline, "oxygenSaturation");
  const respiratory = metricState(day, baseline, "respiratoryRate");
  const temperature = metricState(day, baseline, "wristTemperatureDelta");

  if (section === "sleep") {
    const short = (day.sleepHours ?? 24) < 7;
    const burden = short || report.lateNight || (report.sleepDebtHours ?? 0) >= 3;
    const recoveryAligned = hrv.state === "low" || rhr.state === "high";
    return {
      title: burden ? "今晚优先修复节律，而不是只追求一次补觉" : "睡眠结构暂未出现需要优先处理的模式",
      conclusion: burden
        ? `${short ? "睡眠时长不足" : "作息后移"}${recoveryAligned ? "，并伴恢复指标同向变化" : "，恢复指标暂未同步恶化"}。`
        : "时长与近期节律大致稳定，继续观察连续性比解读单晚阶段比例更重要。",
      evidence: [
        `睡眠 ${formatHealthMetric("sleepHours", day.sleepHours)}`,
        `效率 ${formatHealthMetric("sleepEfficiencyPercentage", day.sleepEfficiencyPercentage)}`,
        `7 日睡眠债 ${report.sleepDebtHours?.toFixed(1) ?? "—"} 小时`,
        `HRV ${formatHealthMetric("heartRateVariability", day.heartRateVariability)}`,
      ],
      interpretation: recoveryAligned
        ? "短睡眠或作息后移与 HRV 下移/静息心率上移同日出现，支持恢复压力这一解释，但压力、训练、饮酒、感染和测量条件仍可能产生相似模式。"
        : "睡眠信号目前主要来自时长与时点，尚缺少恢复指标的同步支持，因此不把它扩大解释为全身恢复异常。",
      action: burden ? "未来 7 天固定起床时间；把目标就寝时间每 2–3 天提前 15–30 分钟，并记录白天困倦与咖啡因时间。" : "保持当前起床锚点，重点观察 7 天平均睡眠和白天功能。",
      tone: burden ? "attention" : "stable",
      confidence: confidence(baseline.length),
    };
  }

  if (section === "recovery") {
    const strained = rhr.state === "high" || hrv.state === "low";
    const aligned = rhr.state === "high" && hrv.state === "low";
    return {
      title: aligned ? "两个恢复信号同向提示：今天不宜额外加量" : strained ? "恢复信号出现单项偏离，先看连续性" : "心率恢复组合位于个人近期范围",
      conclusion: aligned ? "静息心率上移且 HRV 下移，比单项波动更支持近期恢复负担增加。" : strained ? "只有一个恢复指标偏离，暂不能区分真实负荷与测量波动。" : "当前没有发现 RHR–HRV 同向恶化。",
      evidence: [
        `静息心率 ${formatHealthMetric("restingHeartRate", day.restingHeartRate)} · ${rhr.state === "high" ? "高于个人范围" : "未上移"}`,
        `HRV ${formatHealthMetric("heartRateVariability", day.heartRateVariability)} · ${hrv.state === "low" ? "低于个人范围" : "未下移"}`,
        `一分钟心率恢复 ${formatHealthMetric("heartRateRecoveryOneMinute", day.heartRateRecoveryOneMinute)}`,
        `睡眠 ${formatHealthMetric("sleepHours", day.sleepHours)}`,
      ],
      interpretation: aligned ? "常见解释包括睡眠不足、近期训练负荷、心理压力、饮酒、感染早期或脱水；可穿戴设备无法单独区分这些原因。" : "HRV 对测量时段、姿势和呼吸较敏感；在至少 3 个相似方向的夜晚出现前，保持观察而不做疾病推断。",
      action: aligned ? "今天把训练降为轻松活动，正常补水并优先睡眠；连续观察 3 天 RHR、HRV 与症状。" : "保持原计划，不因单次读数突然加量或停训。",
      tone: strained ? "attention" : baseline.length >= 7 ? "stable" : "limited",
      confidence: confidence(baseline.length),
    };
  }

  if (section === "activity") {
    const lowMovement = (day.steps ?? 0) < 5000 && (day.exerciseMinutes ?? 0) < 20;
    const highLoadLowRecovery = (day.exerciseMinutes ?? 0) >= 60 && (rhr.state === "high" || hrv.state === "low");
    return {
      title: highLoadLowRecovery ? "活动负荷与恢复状态不匹配" : lowMovement ? "今日活动偏少，优先增加低强度移动" : "活动量与恢复信号暂未出现明显冲突",
      conclusion: highLoadLowRecovery ? "运动时间较高，同时恢复指标出现偏离，建议先恢复再加量。" : lowMovement ? "步数与锻炼时间都偏少，但单日低活动不等于健康异常。" : "活动数据更适合按周观察，当前只作为身体负荷背景。",
      evidence: [
        `${formatHealthMetric("steps", day.steps)} · ${formatHealthMetric("walkingRunningDistanceKm", day.walkingRunningDistanceKm)}`,
        `运动 ${formatHealthMetric("exerciseMinutes", day.exerciseMinutes)} · 站立 ${formatHealthMetric("standMinutes", day.standMinutes)}`,
        `活动能量 ${formatHealthMetric("activeEnergyKcal", day.activeEnergyKcal)}`,
        `日照 ${formatHealthMetric("timeInDaylightMinutes", day.timeInDaylightMinutes)}`,
      ],
      interpretation: highLoadLowRecovery ? "负荷和恢复的方向不一致时，短期继续加量可能降低训练质量；但没有训练强度与主观疲劳时，不能计算完整训练负荷。" : "步数、能量和运动分钟来自不同算法与传感器，不能相互替代；步态指标只看长期趋势。",
      action: highLoadLowRecovery ? "24–48 小时以内以散步、拉伸和轻松活动为主，待睡眠、HRV 和静息心率回归个人范围后再恢复强度。" : lowMovement ? "安排 20–30 分钟可交谈强度的步行，并分散久坐；如有不适则以舒适程度为准。" : "保持当前节奏，使用 7 天运动分钟和恢复趋势共同决定是否加量。",
      tone: highLoadLowRecovery || lowMovement ? "attention" : "stable",
      confidence: numeric(day.steps) || numeric(day.exerciseMinutes) ? "中等" : "有限",
    };
  }

  const outliers = [rhr, hrv, oxygen, respiratory, temperature].filter((item) => item.state === "high" || item.state === "low").length;
  const respiratoryCluster = oxygen.state === "low" && respiratory.state === "high";
  const systemicCluster = temperature.state === "high" && (rhr.state === "high" || respiratory.state === "high");
  return {
    title: respiratoryCluster ? "血氧与呼吸同向偏离，需要结合症状复核" : systemicCluster ? "腕温与心率/呼吸共同上移，提示短期生理压力" : outliers >= 2 ? `${outliers} 项生命体征共同偏离个人范围` : outliers === 1 ? "单项生命体征偏离，暂不扩大解释" : "夜间生命体征整体位于个人近期范围",
    conclusion: outliers >= 2 ? "多项指标同日变化比单次读数更值得关注，但仍不能据此确定病因。" : outliers === 1 ? "缺少其他指标的同步支持，优先复测并观察连续性。" : "没有发现需要突出警示的多指标组合。",
    evidence: [
      `血氧 ${formatHealthMetric("oxygenSaturation", day.oxygenSaturation)} · 呼吸 ${formatHealthMetric("respiratoryRate", day.respiratoryRate)}`,
      `腕温偏移 ${formatHealthMetric("wristTemperatureDelta", day.wristTemperatureDelta)}`,
      `静息心率 ${formatHealthMetric("restingHeartRate", day.restingHeartRate)} · HRV ${formatHealthMetric("heartRateVariability", day.heartRateVariability)}`,
    ],
    interpretation: respiratoryCluster ? "睡眠呼吸问题、海拔、呼吸道感染、佩戴或测量质量都可能影响这一组合；手表血氧不能替代医用血氧仪。" : systemicCluster ? "感染、饮酒、训练负荷、环境温度或药物变化都可能造成类似模式，需要症状和连续趋势帮助区分。" : "单项波动常受佩戴、睡姿、环境和采样数量影响。",
    action: outliers >= 2 ? "今晚确认佩戴贴合并继续测量；记录发热、呼吸不适、饮酒、海拔和药物变化。若持续 2–3 晚或伴症状，带趋势记录咨询医生。" : "保持佩戴条件一致，观察后续 2–3 晚，不因单次结果自行用药。",
    tone: outliers ? "attention" : baseline.length >= 7 ? "stable" : "limited",
    confidence: confidence(baseline.length),
  };
}

export function buildTrendNarrative(days: DailyHealth[], key: TrendKey, metric: HealthDisplayMetric, label: string): TrendNarrative {
  const values = days.map((day) => day[key]).filter(numeric);
  if (values.length < 4) {
    return { title: `${label}数据不足`, conclusion: "当前点数不足以判断趋势。", evidence: [`有效数据 ${values.length}/${days.length} 天`], interpretation: "缺失日保持断点，系统不会补值。", action: "继续佩戴并积累至少 8 个有效日。", tone: "limited", confidence: "有限", sampleCount: values.length, latest: values.length ? formatHealthMetric(metric, values.at(-1)) : "—", windowMedian: "—", range: "—" };
  }
  const recent = values.slice(-Math.min(7, Math.ceil(values.length / 2)));
  const prior = values.slice(-Math.min(14, values.length), -recent.length);
  const currentMean = mean(recent)!;
  const priorMean = mean(prior);
  const delta = priorMean === undefined ? 0 : currentMean - priorMean;
  const thresholds: Record<TrendKey, number> = { restingHeartRate: 3, heartRateVariability: 5, sleepHours: 0.5, activeEnergyKcal: 80 };
  const changed = Math.abs(delta) >= thresholds[key];
  const concerning = changed && ((key === "restingHeartRate" && delta > 0) || (key === "heartRateVariability" && delta < 0) || (key === "sleepHours" && delta < 0));
  const latestDay = [...days].reverse().find((day) => numeric(day[key]));
  const latest = latestDay?.[key] as number | undefined;
  const paired = key === "restingHeartRate"
    ? `同期 HRV ${formatHealthMetric("heartRateVariability", latestDay?.heartRateVariability)}，睡眠 ${formatHealthMetric("sleepHours", latestDay?.sleepHours)}`
    : key === "heartRateVariability"
      ? `同期静息心率 ${formatHealthMetric("restingHeartRate", latestDay?.restingHeartRate)}，睡眠 ${formatHealthMetric("sleepHours", latestDay?.sleepHours)}`
      : key === "sleepHours"
        ? `同期 HRV ${formatHealthMetric("heartRateVariability", latestDay?.heartRateVariability)}，静息心率 ${formatHealthMetric("restingHeartRate", latestDay?.restingHeartRate)}`
        : `同期运动 ${formatHealthMetric("exerciseMinutes", latestDay?.exerciseMinutes)}，步数 ${formatHealthMetric("steps", latestDay?.steps)}`;
  const direction = !changed ? "近期变化幅度较小" : `${label}${delta > 0 ? "上升" : "下降"} ${formatHealthNumber(metric, Math.abs(delta))}`;
  return {
    title: concerning ? `${direction}，并且方向值得关注` : direction,
    conclusion: concerning ? "变化已超过本软件的图表解读阈值，需要结合恢复、睡眠与症状判断。" : changed ? "趋势发生变化，但数值方向不自动等于变好或变坏。" : "近期均值与前一窗口接近，暂未见明显漂移。",
    evidence: [`有效数据 ${values.length}/${days.length} 天`, `近期均值 ${formatHealthMetric(metric, currentMean)}`, priorMean === undefined ? "缺少前一窗口" : `前一窗口 ${formatHealthMetric(metric, priorMean)}`, paired],
    interpretation: key === "activeEnergyKcal" ? "活动能量是设备估算负荷，不等同于运动质量；需要与运动分钟、步数和恢复反应共同解释。" : "趋势只描述同一设备记录下的变化，不能单独确定疾病、训练效果或具体诱因。",
    action: concerning ? "查看展开证据并连续观察 3–7 天；若同步出现不适或多个生命体征异常，进入建议页查看分层处理。" : "继续保持相似测量条件，按周复核趋势。",
    tone: concerning ? "attention" : "stable",
    confidence: confidence(values.length),
    sampleCount: values.length,
    latest: formatHealthMetric(metric, latest),
    windowMedian: formatHealthMetric(metric, median(values)),
    range: `${formatHealthNumber(metric, Math.min(...values))}–${formatHealthNumber(metric, Math.max(...values))}`,
  };
}

export function buildClinicalAdvice(day: DailyHealth, history: DailyHealth[], report: DailyReport): ClinicalAdviceItem[] {
  const baseline = baselineBefore(day, history);
  const rhr = metricState(day, baseline, "restingHeartRate");
  const hrv = metricState(day, baseline, "heartRateVariability");
  const oxygen = metricState(day, baseline, "oxygenSaturation");
  const respiratory = metricState(day, baseline, "respiratoryRate");
  const temperature = metricState(day, baseline, "wristTemperatureDelta");
  const advice: ClinicalAdviceItem[] = [];

  if (day.highHeartRateEvents + day.lowHeartRateEvents + day.irregularRhythmEvents + day.ecgAbnormalCount > 0) advice.push({
    rank: 0, category: "心率与节律复核", title: "先确认事件发生时段、症状和同日生命体征", tone: "attention", grade: "A",
    clinicalSummary: "手表记录到心率或节律事件。事件本身不能说明心律失常类型，关键是区分运动/睡眠时段、症状、重复性以及是否伴呼吸或血氧变化。",
    observations: [`高心率 ${day.highHeartRateEvents} 次`, `低心率 ${day.lowHeartRateEvents} 次，其中睡眠期 ${day.lowEventsDuringSleep} 次`, `节律/ECG 需复核 ${day.irregularRhythmEvents + day.ecgAbnormalCount} 条`, `血氧 ${formatHealthMetric("oxygenSaturation", day.oxygenSaturation)} · 呼吸 ${formatHealthMetric("respiratoryRate", day.respiratoryRate)}`],
    reasoning: [{ label: "支持", text: "同日事件和生命体征对齐后，比孤立次数更有解释价值。" }, { label: "仍需排除", text: "运动、发热、脱水、咖啡因、酒精、压力、药物以及真实节律问题。" }, { label: "不能确定", text: "Apple Watch 不能替代 12 导联心电图或动态心电图。" }],
    plan: [{ when: "现在", action: "保存事件时间与可用 ECG；记录当时是否运动、发热、心悸、胸闷、头晕或气短。" }, { when: "未来 3 天", action: "保持佩戴条件一致，观察是否重复以及是否与睡眠、血氧或呼吸偏离同日出现。" }],
    monitor: ["事件次数与发生时段", "静息心率/HRV", "症状与药物、咖啡因、酒精变化"], reviewAfter: "3 天或下一次事件后", stop: "不要根据手表读数自行停药、加药或进行高强度测试。", seekCare: "反复发生或伴心悸、气短、头晕、运动耐量下降时就医；胸痛、严重呼吸困难、晕厥/接近晕厥或意识异常时立即急救。", sourceIds: ["apple-heart-alerts", "aha-tachycardia", "aha-bradycardia"],
  });

  if ((day.sleepHours ?? 24) < 7 || report.lateNight || (report.sleepDebtHours ?? 0) >= 3) advice.push({
    rank: 1, category: "睡眠修复", title: "用 7 天固定起床锚点偿还睡眠债", tone: "attention", grade: "A",
    clinicalSummary: "当前睡眠不足或节律后移。若同时出现 HRV 下移或静息心率上移，恢复不足的解释更吻合；若恢复指标稳定，则先把它视为作息问题而非全身异常。",
    observations: [`睡眠 ${formatHealthMetric("sleepHours", day.sleepHours)}`, `睡眠效率 ${formatHealthMetric("sleepEfficiencyPercentage", day.sleepEfficiencyPercentage)}`, `睡眠债 ${report.sleepDebtHours?.toFixed(1) ?? "—"} 小时`, `HRV ${formatHealthMetric("heartRateVariability", day.heartRateVariability)} · 静息心率 ${formatHealthMetric("restingHeartRate", day.restingHeartRate)}`],
    reasoning: [{ label: "支持", text: `${hrv.state === "low" || rhr.state === "high" ? "恢复指标与睡眠同向变化。" : "目前主要证据来自睡眠时长和作息时点。"}` }, { label: "可能原因", text: "晚间光照、咖啡因时间、压力、训练过晚、环境干扰或睡眠机会不足。" }, { label: "仍需排除", text: "打鼾憋醒、明显白天嗜睡、情绪问题或持续失眠。" }],
    plan: [{ when: "今晚", action: "固定明早起床时间；睡前 60 分钟降低光照和高唤醒活动。" }, { when: "未来 7 天", action: "每 2–3 天把上床时间提前 15–30 分钟，不用一次性大幅提前；午后减少咖啡因。" }],
    monitor: ["入睡与起床时间", "总睡眠和效率", "次日 HRV/静息心率", "白天困倦与专注力"], reviewAfter: "连续执行 7 天", stop: "若调整导致白天功能进一步下降或出现明显不适，停止自行调整并评估原因。", seekCare: "持续严重失眠、明显白天功能受损，或伴大声打鼾、憋醒、晨起头痛时咨询专业人员。", sourceIds: ["cdc-sleep-duration", "apple-vitals"],
  });

  if (rhr.state === "high" || hrv.state === "low" || (day.heartRateRecoveryOneMinute !== undefined && day.heartRateRecoveryOneMinute < 12)) advice.push({
    rank: 2, category: "恢复与训练", title: "暂缓额外加量，用 72 小时趋势验证恢复", tone: "attention", grade: "B",
    clinicalSummary: "静息心率、HRV 或运动后心率恢复出现恢复压力线索。单项读数不够诊断，但多项同向或连续多日偏离时，应优先降低可避免负荷。",
    observations: [`静息心率 ${formatHealthMetric("restingHeartRate", day.restingHeartRate)} · ${stateText(rhr.state)}`, `HRV ${formatHealthMetric("heartRateVariability", day.heartRateVariability)} · ${stateText(hrv.state)}`, `一分钟心率恢复 ${formatHealthMetric("heartRateRecoveryOneMinute", day.heartRateRecoveryOneMinute)}`, `运动 ${formatHealthMetric("exerciseMinutes", day.exerciseMinutes)}`],
    reasoning: [{ label: "支持", text: rhr.state === "high" && hrv.state === "low" ? "RHR 上移和 HRV 下移同向出现。" : "目前只有部分恢复信号偏离。" }, { label: "常见解释", text: "睡眠不足、训练负荷、心理压力、酒精、脱水或感染早期。" }, { label: "测量限制", text: "心率恢复受运动类型、峰值强度和停止方式影响，不同试验阈值不能直接混用。" }],
    plan: [{ when: "今天", action: "取消额外高强度训练，改为可交谈强度活动；正常补水并优先保证睡眠。" }, { when: "未来 72 小时", action: "在相似佩戴与测量条件下观察 RHR、HRV、睡眠和主观疲劳是否回归。" }],
    monitor: ["静息心率和 HRV", "主观疲劳", "睡眠时长", "运动耐量"], reviewAfter: "72 小时", stop: "读数回归个人范围且本人感觉正常后，再逐步恢复训练强度。", seekCare: "偏离反复出现并伴心悸、气短、头晕或运动耐量下降时联系医生。", sourceIds: ["apple-vitals", "apple-watch-hrv-validation", "cole-heart-rate-recovery"],
  });

  if ((oxygen.state === "low" && respiratory.state === "high") || (temperature.state === "high" && (rhr.state === "high" || respiratory.state === "high"))) advice.push({
    rank: 1, category: "夜间生命体征", title: "复测并记录症状，优先排查多指标共同诱因", tone: "attention", grade: "B",
    clinicalSummary: "两项或以上夜间生命体征同向偏离。相较单项异常，这更支持身体状态发生变化，但感染、睡眠呼吸、海拔、饮酒和测量质量仍需区分。",
    observations: [`血氧 ${formatHealthMetric("oxygenSaturation", day.oxygenSaturation)}`, `呼吸 ${formatHealthMetric("respiratoryRate", day.respiratoryRate)}`, `腕温 ${formatHealthMetric("wristTemperatureDelta", day.wristTemperatureDelta)}`, `静息心率 ${formatHealthMetric("restingHeartRate", day.restingHeartRate)}`],
    reasoning: [{ label: "模式", text: oxygen.state === "low" && respiratory.state === "high" ? "血氧下移与呼吸频率上移同日出现。" : "腕温与心率/呼吸共同上移。" }, { label: "可能原因", text: "呼吸道感染、睡眠呼吸问题、饮酒、海拔、训练压力或环境变化。" }, { label: "仍需验证", text: "佩戴贴合度、采样数量、医用体温或医用血氧复测及实际症状。" }],
    plan: [{ when: "今晚", action: "确认手表佩戴贴合，避免在饮酒或剧烈运动后把一次读数当作基线。" }, { when: "未来 2–3 晚", action: "记录发热、咳嗽、打鼾憋醒、晨起头痛和白天嗜睡；条件允许时用合规设备复测。" }],
    monitor: ["血氧和呼吸趋势", "腕温与静息心率", "发热/呼吸症状", "连续出现天数"], reviewAfter: "2–3 个夜晚", stop: "不要仅凭腕温或手表血氧自行服药。", seekCare: "持续偏离并伴呼吸不适、发热或明显白天功能下降时就医；严重呼吸困难、胸痛、意识异常时立即急救。", sourceIds: ["apple-vitals", "apple-blood-oxygen", "aha-sleep-breathing"],
  });

  if (!advice.length) advice.push({
    rank: 4, category: "维持与预防", title: "保持当前节律，用周趋势代替单日追分", tone: "stable", grade: "A",
    clinicalSummary: "今天没有触发需要优先干预的确定性组合。稳定意味着维持当前习惯并继续观察，不代表可以突然增加训练或忽视症状。",
    observations: [`完整度 ${report.dataQuality.percent}%`, `睡眠 ${formatHealthMetric("sleepHours", day.sleepHours)}`, `步数 ${formatHealthMetric("steps", day.steps)}`, `HRV ${formatHealthMetric("heartRateVariability", day.heartRateVariability)}`],
    reasoning: [{ label: "支持", text: "主要生命体征未形成多项同向偏离。" }, { label: "限制", text: "可穿戴设备不能覆盖血压、实验室检查、病史和主观症状。" }],
    plan: [{ when: "未来 7 天", action: "保持相近睡眠机会和活动节奏，每周复核趋势而不是追逐单日分数。" }], monitor: ["睡眠连续性", "恢复趋势", "活动与身体感受"], reviewAfter: "7 天", stop: "身体感受明显变差时不继续按原负荷执行。", seekCare: "出现胸痛、严重呼吸困难、晕厥或意识异常时立即急救。", sourceIds: ["cdc-sleep-duration", "cdc-activity-guidelines"],
  });

  return advice.sort((a, b) => a.rank - b.rank).slice(0, 3).map((item, index) => ({ ...item, rank: index + 1 }));
}
