import type {
  DailyHealth,
  EvidenceItem,
  HealthInsight,
  MetricCard,
  PeriodDays,
  PossibleExplanation,
} from "./types";
import { formatHealthMetric, formatHealthNumber, type HealthDisplayMetric } from "./format";

type NumericMetric =
  | "restingHeartRate"
  | "heartRateVariability"
  | "respiratoryRate"
  | "oxygenSaturation"
  | "wristTemperatureDelta"
  | "sleepHours";

interface MetricState {
  state: "high" | "low" | "typical" | "unknown";
  median?: number;
  lower?: number;
  upper?: number;
  value?: number;
  samples: number;
}

const METRIC_FLOORS: Record<NumericMetric, number> = {
  restingHeartRate: 5,
  heartRateVariability: 7,
  respiratoryRate: 1.5,
  oxygenSaturation: 1.5,
  wristTemperatureDelta: 0.3,
  sleepHours: 0.75,
};

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianAbsoluteDeviation(values: number[]): number | undefined {
  const center = median(values);
  if (center === undefined) return undefined;
  return median(values.map((value) => Math.abs(value - center)));
}

export function metricState(
  current: DailyHealth,
  baseline: DailyHealth[],
  metric: NumericMetric,
): MetricState {
  const value = current[metric];
  const values = baseline
    .map((day) => day[metric])
    .filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (typeof value !== "number" || values.length < 7) {
    return { state: "unknown", value, samples: values.length };
  }
  const center = median(values)!;
  const mad = medianAbsoluteDeviation(values) ?? 0;
  // 1.4826 将 MAD 换算为近似标准差；下限防止稳定基线因微小噪声频繁报警。
  const radius = Math.max(2.5 * 1.4826 * mad, METRIC_FLOORS[metric]);
  const lower = center - radius;
  const upper = center + radius;
  return {
    state: value < lower ? "low" : value > upper ? "high" : "typical",
    median: center,
    lower,
    upper,
    value,
    samples: values.length,
  };
}

function evidenceFromState(
  label: string,
  metric: NumericMetric,
  state: MetricState,
): EvidenceItem | undefined {
  if (state.value === undefined || state.median === undefined || state.state === "unknown") {
    return undefined;
  }
  return {
    label,
    value: formatHealthMetric(metric, state.value),
    comparison: `个人基线中位数 ${formatHealthMetric(metric, state.median)}（${state.samples} 天）`,
    state: state.state,
  };
}

function explanation(
  title: string,
  rationale: string,
  fit: PossibleExplanation["fit"],
): PossibleExplanation {
  return { title, rationale, fit };
}

function completeSorted(days: DailyHealth[]): DailyHealth[] {
  return days.filter((day) => day.complete).sort((a, b) => a.date.localeCompare(b.date));
}

function previousDays(days: DailyHealth[], date: string, count = 28): DailyHealth[] {
  return completeSorted(days)
    .filter((day) => day.date < date)
    .slice(-count);
}

function latestComplete(days: DailyHealth[]): DailyHealth | undefined {
  return completeSorted(days).at(-1);
}

function outlierEvidence(
  states: Record<NumericMetric, MetricState>,
): EvidenceItem[] {
  const labels: Record<NumericMetric, string> = {
    restingHeartRate: "静息心率",
    heartRateVariability: "HRV",
    respiratoryRate: "呼吸频率",
    oxygenSaturation: "血氧趋势",
    wristTemperatureDelta: "腕温偏移",
    sleepHours: "睡眠时长",
  };
  return (Object.keys(states) as NumericMetric[])
    .filter((metric) => states[metric].state === "high" || states[metric].state === "low")
    .map((metric) => evidenceFromState(labels[metric], metric, states[metric]))
    .filter((item): item is EvidenceItem => Boolean(item));
}

export function deriveHealthInsights(days: DailyHealth[], period: PeriodDays): HealthInsight[] {
  const latest = latestComplete(days);
  if (!latest) return [];
  const baseline = previousDays(days, latest.date, 28);
  const window = completeSorted(days).filter((day) => day.date <= latest.date).slice(-period);
  const metrics: NumericMetric[] = [
    "restingHeartRate",
    "heartRateVariability",
    "respiratoryRate",
    "oxygenSaturation",
    "wristTemperatureDelta",
    "sleepHours",
  ];
  const analyses = window.map((day) => {
    const dayBaseline = previousDays(days, day.date, 28);
    const states = Object.fromEntries(
      metrics.map((metric) => [metric, metricState(day, dayBaseline, metric)]),
    ) as Record<NumericMetric, MetricState>;
    return { day, states, outliers: outlierEvidence(states), baselineDays: dayBaseline.length };
  });
  const highEvents = window.reduce((sum, day) => sum + day.highHeartRateEvents, 0);
  const lowEvents = window.reduce((sum, day) => sum + day.lowHeartRateEvents, 0);
  const lowDuringSleep = window.reduce((sum, day) => sum + day.lowEventsDuringSleep, 0);
  const insights: HealthInsight[] = [];

  if (baseline.length < 7) {
    insights.push({
      id: "baseline-building",
      severity: "info",
      confidence: "有限",
      title: "个人基线仍在建立",
      summary: "至少需要 7 个完整夜晚才能开始多指标偏离判断，28 天后稳定性更好。",
      dateRange: latest.date,
      evidence: [{ label: "可用基线", value: `${baseline.length} 天`, comparison: "最低 7 天，推荐 28 天", state: "context" }],
      explanations: [],
      actions: ["继续佩戴并确保睡眠追踪开启；基线不足时只展示原始趋势，不推断原因。"],
      sourceIds: ["apple-vitals"],
      limitation: "Apple 的典型范围算法未公开；本软件使用透明的中位数与 MAD 稳健范围。",
    });
  }

  if (highEvents > 0) {
    const eventDays = analyses.filter(({ day }) => day.highHeartRateEvents > 0);
    const respiratoryDay = eventDays.find(({ states }) =>
      states.oxygenSaturation.state === "low" && states.respiratoryRate.state === "high",
    );
    const systemicDay = eventDays.find(({ states }) =>
      states.wristTemperatureDelta.state === "high" &&
      (states.restingHeartRate.state === "high" || states.respiratoryRate.state === "high"),
    );
    const recoveryDay = eventDays.find(({ day, states }) =>
      (states.sleepHours.state === "low" || (day.sleepHours ?? 24) < 7) &&
      states.heartRateVariability.state === "low",
    );
    const rhythmDay = eventDays.find(({ day }) =>
      day.ecgAbnormalCount > 0 || day.irregularRhythmEvents > 0,
    );
    const respiratoryPattern = Boolean(respiratoryDay);
    const systemicPattern = Boolean(systemicDay);
    const recoveryPattern = Boolean(recoveryDay);
    const strongest = respiratoryDay ?? rhythmDay ?? systemicDay ?? recoveryDay ?? eventDays.at(-1);
    const explanations: PossibleExplanation[] = [];
    if (respiratoryPattern) {
      explanations.push(explanation("呼吸相关负担需要优先排查", "血氧趋势下移与呼吸频率上移同时出现，比单独一次高心率更值得关注。", "较吻合"));
    }
    if (systemicPattern) {
      explanations.push(explanation("急性生理压力或身体不适", "腕温、静息心率或呼吸频率共同偏离时，可见于疾病、饮酒、海拔或药物等影响。", "可能"));
    }
    if (recoveryPattern) {
      explanations.push(explanation("睡眠不足或恢复不充分", "短睡眠与 HRV 下移可支持恢复压力，但不能区分压力、饮酒、训练负荷或其他原因。", "可能"));
    }
    if (rhythmDay) {
      explanations.push(explanation("同日心律记录需要复核", "同日存在非“窦性心律”的 ECG 分类或不规则节律通知；这可能包含房颤、心率过高/过低或无法判定，需查看原始分类并由医生确认。", "较吻合"));
    }
    if (!explanations.length) {
      explanations.push(explanation("暂时性诱因或节律问题", "脱水、咖啡因、酒精、压力、药物、感染及心律异常都可能影响心率，手表数据本身无法区分。", "需补充信息"));
    }
    insights.push({
      id: "high-heart-rate-cross-check",
      severity: respiratoryPattern ? "important" : "attention",
      confidence: respiratoryPattern || systemicPattern ? "中等" : "有限",
      title: `${period} 天内记录到 ${highEvents} 个高心率事件`,
      summary: `事件分布在 ${eventDays.length} 天；每个事件只与同一天的睡眠和生命体征对齐，避免跨日误判。`,
      dateRange: `${window.at(0)?.date} 至 ${latest.date}`,
      evidence: [
        { label: "高心率事件", value: `${highEvents} 个`, comparison: `Apple 通知通常表示静止约 10 分钟仍超过设置阈值`, state: "high" },
        ...(rhythmDay ? [{ label: `${rhythmDay.day.date} · ECG/节律`, value: `${rhythmDay.day.ecgAbnormalCount + rhythmDay.day.irregularRhythmEvents} 条需复核`, comparison: "仅表示分类不是“窦性心律”或出现节律通知", state: "context" as const }] : []),
        ...(strongest?.outliers.map((item) => ({ ...item, label: `${strongest.day.date} · ${item.label}` })) ?? []),
      ],
      explanations,
      actions: [
        "回看事件时段是否有运动、发热/不适、饮酒、咖啡因、药物变化或明显压力，并在软件中补记。",
        "若反复发生或伴心悸、气短、头晕，请保存事件时间和可用 ECG，联系医生评估。",
        "若伴胸痛、严重呼吸困难、晕厥/接近晕厥或意识异常，立即呼叫急救。",
      ],
      sourceIds: ["apple-heart-alerts", "apple-vitals", "aha-tachycardia"],
      limitation: "Apple Watch 不能仅凭心率数值判断心动过速类型；确诊通常需要临床心电图和病史。",
    });
  }

  if (lowEvents > 0) {
    const sleepRatio = lowEvents ? lowDuringSleep / lowEvents : 0;
    const eventDays = analyses.filter(({ day }) => day.lowHeartRateEvents > 0);
    const respiratoryDay = eventDays.find(({ states }) =>
      states.oxygenSaturation.state === "low" || states.respiratoryRate.state === "high",
    );
    const respiratoryPattern = Boolean(respiratoryDay);
    const mainlySleeping = sleepRatio >= 0.8;
    const rhythmDay = eventDays.find(({ day }) =>
      day.ecgAbnormalCount > 0 || day.irregularRhythmEvents > 0,
    );
    const strongest = respiratoryDay ?? rhythmDay ?? eventDays.at(-1);
    const explanations: PossibleExplanation[] = [];
    if (mainlySleeping && !respiratoryPattern) {
      explanations.push(explanation("睡眠期生理性减慢", "低心率事件主要与睡眠重叠，且呼吸/血氧趋势没有同步偏离；睡眠时心率降低可以是生理现象。", "较吻合"));
    }
    if (mainlySleeping && respiratoryPattern) {
      explanations.push(explanation("睡眠呼吸问题需要排查", "睡眠期低心率同时伴血氧趋势下移或呼吸频率上移，建议结合打鼾、憋醒和白天嗜睡向医生说明。", "可能"));
    }
    if (!mainlySleeping) {
      explanations.push(explanation("清醒期低心率需结合症状和药物", "体能较好者可有较低静息心率，但药物、甲状腺、电解质或传导问题等也可能造成低心率。", "需补充信息"));
    }
    if (rhythmDay) {
      explanations.push(explanation("同日心律记录需要复核", "同日存在非“窦性心律”的 ECG 分类或不规则节律通知，建议保留原始 PDF/CSV 给医生查看。", "较吻合"));
    }
    insights.push({
      id: "low-heart-rate-cross-check",
      severity: respiratoryPattern || !mainlySleeping ? "attention" : "notice",
      confidence: mainlySleeping ? "中等" : "有限",
      title: `${period} 天内记录到 ${lowEvents} 个低心率事件`,
      summary: `${Math.round(sleepRatio * 100)}% 的事件与睡眠重叠；这项时段证据会显著影响解释，但不能排除其他原因。`,
      dateRange: `${window.at(0)?.date} 至 ${latest.date}`,
      evidence: [
        { label: "低心率事件", value: `${lowEvents} 个`, comparison: `${lowDuringSleep} 个与睡眠重叠`, state: "low" },
        ...(rhythmDay ? [{ label: `${rhythmDay.day.date} · ECG/节律`, value: `${rhythmDay.day.ecgAbnormalCount + rhythmDay.day.irregularRhythmEvents} 条需复核`, comparison: "仅表示分类不是“窦性心律”或出现节律通知", state: "context" as const }] : []),
        ...(strongest?.outliers.map((item) => ({ ...item, label: `${strongest.day.date} · ${item.label}` })) ?? []),
      ],
      explanations,
      actions: [
        "记录是否有头晕、乏力、气短、运动耐量下降、接近晕厥，以及是否使用影响心率的药物。",
        respiratoryPattern
          ? "如伴打鼾、憋醒、晨起头痛或白天嗜睡，可把睡眠期事件与血氧/呼吸趋势一并交给医生评估。"
          : "若无症状且集中在睡眠期，可先持续观察趋势；不要仅凭手表读数自行停药。",
        "若伴胸痛、严重呼吸困难、晕厥/接近晕厥或意识异常，立即呼叫急救。",
      ],
      sourceIds: ["apple-heart-alerts", "aha-bradycardia", "aha-sleep-breathing"],
      limitation: "手表不能识别所有传导阻滞，也不能替代 12 导联心电图、动态心电图或睡眠监测。",
    });
  }

  analyses
    .filter(({ outliers }) => outliers.length >= 2)
    .slice(-5)
    .reverse()
    .forEach(({ day, states, outliers }) => {
      const hasHeartEvent = day.highHeartRateEvents > 0 || day.lowHeartRateEvents > 0;
      const explanations: PossibleExplanation[] = [];
      if (states.oxygenSaturation.state === "low" && states.respiratoryRate.state === "high") {
        explanations.push(explanation("呼吸相关变化", "血氧趋势下移与呼吸频率上移同日出现，建议优先结合症状和连续性判断。", "较吻合"));
      }
      if (
        states.wristTemperatureDelta.state === "high" &&
        (states.restingHeartRate.state === "high" || states.respiratoryRate.state === "high")
      ) {
        explanations.push(explanation("急性生理压力或身体不适", "腕温与心率/呼吸共同上移，可见于疾病、饮酒、药物、海拔或其他短期压力。", "可能"));
      }
      if (
        (states.sleepHours.state === "low" || (day.sleepHours ?? 24) < 7) &&
        states.heartRateVariability.state === "low"
      ) {
        explanations.push(explanation("睡眠不足或恢复压力", "短睡眠与 HRV 下移同日出现，支持恢复不充分，但不能确定具体诱因。", "可能"));
      }
      if (!explanations.length) {
        explanations.push(explanation("共同的短期影响因素", "疾病、酒精、药物、海拔、训练负荷或睡眠不足都可能同时影响多项夜间指标。", "需补充信息"));
      }
      insights.push({
        id: `multi-vital-outlier-${day.date}`,
        severity: hasHeartEvent ? "notice" : "attention",
        confidence: "中等",
        title: `${day.date} 有 ${outliers.length} 项生命体征偏离个人基线`,
        summary: "多项指标在同一天共同变化比孤立读数更有信息量，但仍只表示身体状态发生变化。",
        dateRange: day.date,
        evidence: outliers,
        explanations: [
          ...explanations,
          explanation("测量条件变化", "佩戴过松、皮肤灌注、运动或睡眠数据缺失也可能制造偏差，应先检查数据质量。", "需补充信息"),
        ],
        actions: ["核对当日佩戴、饮酒、药物、海拔、训练、睡眠和症状；连续 2–3 天仍偏离或伴不适时联系医生。"],
        sourceIds: ["apple-vitals", "apple-blood-oxygen", "apple-heart-sensor"],
        limitation: "本规则使用逐日向前看的 28 天稳健基线，避免使用未来数据；它不是临床参考区间。",
      });
    });

  if (!insights.length) {
    insights.push({
      id: "no-material-signal",
      severity: "info",
      confidence: baseline.length >= 7 ? "中等" : "有限",
      title: "暂未发现需要突出提示的组合信号",
      summary: "这表示当前数据没有触发本软件的趋势规则，不等于排除健康问题。",
      dateRange: latest.date,
      evidence: [],
      explanations: [],
      actions: ["继续关注持续趋势；如果本人感觉不适，应以症状和专业医疗评估为准。"],
      sourceIds: ["apple-vitals"],
      limitation: "可穿戴设备存在漏测、误差和未覆盖时段。",
    });
  }

  const order = { important: 0, attention: 1, notice: 2, info: 3 } as const;
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}

function average(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : undefined;
}

function metricDelta(metric: HealthDisplayMetric, current?: number, previous?: number, suffix = ""): string | undefined {
  if (current === undefined || previous === undefined) return undefined;
  const delta = current - previous;
  return `较上一周期 ${formatHealthNumber(metric, delta, { forceSign: true })}${suffix}`;
}

export function buildMetricCards(days: DailyHealth[], period: PeriodDays): MetricCard[] {
  const complete = completeSorted(days);
  const current = complete.slice(-period);
  const previous = complete.slice(-period * 2, -period);
  const coverage = (metric: keyof DailyHealth) =>
    `${current.filter((day) => typeof day[metric] === "number").length}/${period} 天`;
  const sleep = average(current.map((day) => day.sleepHours));
  const previousSleep = average(previous.map((day) => day.sleepHours));
  const rhr = average(current.map((day) => day.restingHeartRate));
  const previousRhr = average(previous.map((day) => day.restingHeartRate));
  const hrv = average(current.map((day) => day.heartRateVariability));
  const previousHrv = average(previous.map((day) => day.heartRateVariability));
  const respiratory = average(current.map((day) => day.respiratoryRate));
  const oxygen = average(current.map((day) => day.oxygenSaturation));
  const exercise = average(current.map((day) => day.exerciseMinutes));
  return [
    { key: "sleep", label: "平均睡眠", value: formatHealthNumber("sleepHours", sleep), unit: "小时", delta: metricDelta("sleepHours", sleep, previousSleep, " 小时"), tone: sleep !== undefined && sleep < 7 ? "watch" : "neutral", coverage: coverage("sleepHours") },
    { key: "rhr", label: "静息心率", value: formatHealthNumber("restingHeartRate", rhr), unit: "次/分", delta: metricDelta("restingHeartRate", rhr, previousRhr), tone: "neutral", coverage: coverage("restingHeartRate") },
    { key: "hrv", label: "HRV", value: formatHealthNumber("heartRateVariability", hrv), unit: "ms", delta: metricDelta("heartRateVariability", hrv, previousHrv), tone: "neutral", coverage: coverage("heartRateVariability") },
    { key: "respiratory", label: "呼吸频率", value: formatHealthNumber("respiratoryRate", respiratory), unit: "次/分", tone: "neutral", coverage: coverage("respiratoryRate") },
    { key: "oxygen", label: "血氧趋势", value: formatHealthNumber("oxygenSaturation", oxygen), unit: "%", tone: "neutral", coverage: coverage("oxygenSaturation") },
    { key: "exercise", label: "日均锻炼", value: formatHealthNumber("exerciseMinutes", exercise), unit: "分钟", tone: "neutral", coverage: coverage("exerciseMinutes") },
  ];
}
