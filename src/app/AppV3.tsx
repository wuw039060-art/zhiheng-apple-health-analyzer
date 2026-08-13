import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { buildDailyReport, type DailyReport, type ReportTone } from "../domain/dailyReport";
import { deriveHealthInsights, median, metricState } from "../domain/analytics";
import { buildClinicalAdvice, buildSectionNarrative, buildTrendNarrative, type SectionNarrative } from "../domain/clinicalNarrative";
import { formatHealthMetric, formatHealthNumber, type HealthDisplayMetric } from "../domain/format";
import { KNOWLEDGE_SOURCES, SAFETY_COPY } from "../domain/knowledge";
import { calculateStateAge } from "../domain/stateAge";
import type { DashboardPayload, DailyHealth, HealthInsight, ImportProgress, PeriodDays } from "../domain/types";

type AppView = "daily" | "insights" | "advice" | "data" | "settings";
type IconName = "daily" | "insights" | "advice" | "data" | "settings" | "import" | "shield" | "calendar" | "moon" | "heart" | "activity" | "spark" | "chevron" | "check" | "warning" | "database";

const EMPTY_DASHBOARD: DashboardPayload = { days: [], historyDays: 0 };
const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

const METRIC_IDS = {
  sleep: "HKCategoryTypeIdentifierSleepAnalysis",
  heart: "HKQuantityTypeIdentifierHeartRate",
  rhr: "HKQuantityTypeIdentifierRestingHeartRate",
  hrv: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  respiratory: "HKQuantityTypeIdentifierRespiratoryRate",
  oxygen: "HKQuantityTypeIdentifierOxygenSaturation",
  temperature: "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
  steps: "HKQuantityTypeIdentifierStepCount",
} as const;

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    daily: "M5 4h14v16H5zM8 2v4m8-4v4M5 9h14",
    insights: "M4 17l5-5 4 3 7-8m-5 0h5v5",
    advice: "M9 18h6m-5 3h4m-7-8a5 5 0 1 1 10 0c0 2-1 3-2 4H9c-1-1-2-2-2-4Z",
    data: "M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3Zm0 0v6c0 2 4 3 8 3s8-1 8-3V6M4 12v6c0 2 4 3 8 3s8-1 8-3v-6",
    settings: "M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Zm8-3.5 2-1-2-3-2 .4a8 8 0 0 0-1.5-1.5L17 5l-3-2-1 2a8 8 0 0 0-2 0L10 3 7 5l.5 2.4A8 8 0 0 0 6 9l-2-.5-2 3 2 1a8 8 0 0 0 0 2l-2 1 2 3 2-.5A8 8 0 0 0 7.5 20L7 22h4l1-2a8 8 0 0 0 2 0l1 2h4l-.5-2.4A8 8 0 0 0 20 18l2 .5 2-3-2-1a8 8 0 0 0 0-2Z",
    import: "M12 3v12m0 0 5-5m-5 5-5-5M5 21h14",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-5",
    calendar: "M5 4h14v16H5zM8 2v4m8-4v4M5 9h14",
    moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z",
    heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6a5.5 5.5 0 0 0 1-8.8Z",
    activity: "M3 12h4l2.5-6 4.5 12 2.5-6H21",
    spark: "m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z",
    chevron: "m9 18 6-6-6-6",
    check: "m5 12 4 4L19 6",
    warning: "M12 3 2 21h20L12 3Zm0 7v5m0 3v.01",
    database: "M4 6c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3Zm0 0v12c0 2 4 3 8 3s8-1 8-3V6",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

const formatDateLabel = (date: string) => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const shiftDate = (date: string, amount: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); };
const formatClock = (minutes?: number) => minutes === undefined ? "—" : `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;
const metricSamples = (day: DailyHealth, id: string) => day.sampleCounts?.[id] ?? 0;

function EmptyMetric({ title, reason, hint }: { title: string; reason: string; hint: string }) {
  return <div className="empty-metric"><span><Icon name="database" /></span><div><strong>{title}</strong><p>{reason}</p><small>{hint}</small></div></div>;
}

function MetricTile({ label, value, detail, tone = "neutral", accent }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "attention"; accent?: "blue" | "pink" | "gold" | "green" }) {
  return <article className={`metric-tile tone-${tone} accent-${accent ?? "none"}`}><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>;
}

function StatusPill({ tone, children }: { tone: ReportTone; children: React.ReactNode }) {
  return <span className={`status-pill status-${tone}`}><i />{children}</span>;
}

function AnalysisBlock({ analysis, label = "多指标解读" }: { analysis: SectionNarrative; label?: string }) {
  return <section className={`analysis-block analysis-${analysis.tone}`}>
    <div className="analysis-lead"><span>{label} · 把握度 {analysis.confidence}</span><h3>{analysis.title}</h3><p>{analysis.conclusion}</p></div>
    <details><summary>查看交叉证据、可能解释与下一步 <Icon name="chevron" /></summary><div className="analysis-detail"><div className="analysis-evidence">{analysis.evidence.map((item) => <span key={item}>{item}</span>)}</div><article><small>如何理解</small><p>{analysis.interpretation}</p></article><article className="analysis-action"><small>建议下一步</small><p>{analysis.action}</p></article></div></details>
  </section>;
}

function HeaderBar({ selectedDate, earliest, latest, day, dashboard, onDateChange, onImport }: {
  selectedDate: string; earliest: string; latest: string; day?: DailyHealth; dashboard: DashboardPayload;
  onDateChange: (date: string) => void; onImport: () => void;
}) {
  const sources = day?.sources?.length ? day.sources.slice(0, 2).join(" + ") : "来源待识别";
  const quality = day ? buildDailyReport(day, dashboard.days).dataQuality.percent : 0;
  return <header className="desktop-topbar">
    <div className="date-controls">
      <button aria-label="上一天" disabled={selectedDate <= earliest} onClick={() => onDateChange(shiftDate(selectedDate, -1))}>‹</button>
      <label><Icon name="calendar" /><input type="date" value={selectedDate} min={earliest} max={latest} onChange={(event) => onDateChange(event.target.value)} /></label>
      <button aria-label="下一天" disabled={selectedDate >= latest} onClick={() => onDateChange(shiftDate(selectedDate, 1))}>›</button>
      <button className="today-button" onClick={() => onDateChange(latest)}>返回最新</button>
    </div>
    <div className="source-status">
      <span><i className="local-dot" />仅本机</span>
      <span>完整度 <strong>{quality}%</strong></span>
      <span title={day?.sources?.join("、")}>{sources}</span>
      <span>更新 {dashboard.importSummary?.importedAt ? new Date(dashboard.importSummary.importedAt).toLocaleDateString("zh-CN") : "—"}</span>
      <button className="import-button" onClick={onImport}><Icon name="import" />导入</button>
    </div>
  </header>;
}

function Sidebar({ active, onNavigate }: { active: AppView; onNavigate: (view: AppView) => void }) {
  const items: Array<{ id: AppView; label: string; icon: IconName; caption: string }> = [
    { id: "daily", label: "每日", icon: "daily", caption: "身体报告" },
    { id: "insights", label: "洞察", icon: "insights", caption: "变化与模式" },
    { id: "advice", label: "建议", icon: "advice", caption: "行动与复盘" },
    { id: "data", label: "数据", icon: "data", caption: "来源与质量" },
    { id: "settings", label: "设置", icon: "settings", caption: "隐私与方法" },
  ];
  return <aside className="sidebar">
    <button className="wordmark" onClick={() => onNavigate("daily")}><span><Icon name="heart" /></span><div><strong>知衡</strong><small>Health Intelligence</small></div></button>
    <nav>{items.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onNavigate(item.id)}><span><Icon name={item.icon} /></span><div><strong>{item.label}</strong><small>{item.caption}</small></div></button>)}</nav>
    <div className="sidebar-footer"><span><Icon name="shield" /></span><p><strong>Local first</strong><small>原始健康数据不离开此电脑</small></p></div>
  </aside>;
}

function SleepPanel({ day, history, report }: { day: DailyHealth; history: DailyHealth[]; report: DailyReport }) {
  const stages = [
    { label: "REM", value: day.remSleepHours, color: "#f653b7" },
    { label: "核心", value: day.coreSleepHours, color: "#2867f0" },
    { label: "深睡", value: day.deepSleepHours, color: "#5637bb" },
    { label: "清醒", value: day.awakeMinutes === undefined ? undefined : day.awakeMinutes / 60, color: "#f2be3e" },
  ];
  const total = stages.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const analysis = buildSectionNarrative("sleep", day, history, report);
  return <section className="report-section sleep-section">
    <div className="section-title"><div><span className="section-index">01</span><p>昨夜睡眠</p><h2>{formatHealthMetric("sleepHours", day.sleepHours)}</h2></div><StatusPill tone={day.sleepHours === undefined ? "limited" : day.sleepHours < 7 ? "attention" : "stable"}>{report.lateNight ? "识别为作息后移" : day.sleepHours === undefined ? "数据不足" : "已与个人基线比较"}</StatusPill></div>
    <div className="sleep-layout">
      <div className="sleep-timeline">
        <div className="timeline-caption"><span>{formatClock(day.sleepStartMinutes)} 入睡</span><span>{formatClock(day.sleepEndMinutes)} 醒来</span></div>
        {total > 0 ? <><div className="stage-bar">{stages.filter((item) => item.value !== undefined).map((item) => <i key={item.label} style={{ width: `${((item.value ?? 0) / total) * 100}%`, background: item.color }} title={`${item.label} ${item.value?.toFixed(1)} 小时`} />)}</div><div className="stage-legend">{stages.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}<strong>{item.value === undefined ? "—" : `${item.value.toFixed(1)}h`}</strong></span>)}</div></> : <EmptyMetric title="缺少睡眠阶段" reason="本次导出只有睡眠总时长，未发现 REM、核心或深睡区间。" hint="不会把稀疏数据插值成连续睡眠曲线。" />}
      </div>
      <div className="sleep-facts">
        <MetricTile label="睡眠效率" value={formatHealthMetric("sleepEfficiencyPercentage", day.sleepEfficiencyPercentage)} detail="实际睡眠 / 卧床时长" accent="pink" />
        <MetricTile label="7 日睡眠债务" value={report.sleepDebtHours === undefined ? "—" : `${report.sleepDebtHours.toFixed(1)} 小时`} detail="按每夜 8 小时透明估算" accent="gold" tone={(report.sleepDebtHours ?? 0) > 5 ? "attention" : "neutral"} />
        <MetricTile label="夜间清醒" value={formatHealthMetric("awakeMinutes", day.awakeMinutes)} detail={`${metricSamples(day, METRIC_IDS.sleep)} 条睡眠记录`} accent="blue" />
      </div>
    </div>
    <AnalysisBlock analysis={analysis} label="睡眠解读" />
  </section>;
}

function VitalityPanel({ report }: { report: DailyReport }) {
  return <section className="vitality-card">
    <div className="vitality-score"><span>身体活力</span><strong>{report.vitalityScore ?? "—"}</strong><small>产品推导指标 · 可信度 {report.confidence}</small></div>
    <div className="factor-list"><div className="factor-head"><span>主要贡献</span><small>点击式透明计算，无医学诊断含义</small></div>{report.factors.slice(0, 5).map((factor) => <div className={`factor factor-${factor.tone}`} key={factor.label}><span>{factor.label}</span><p>{factor.detail}</p><strong>{factor.impact > 0 ? "+" : ""}{factor.impact}</strong></div>)}</div>
  </section>;
}

function EnergyCycle({ day, history }: { day: DailyHealth; history: DailyHealth[] }) {
  const priorSleep = history.filter((item) => item.date <= day.date && item.sleepEndMinutes !== undefined).slice(-28);
  const ready = priorSleep.length >= 14 && day.sleepEndMinutes !== undefined && day.sleepHours !== undefined;
  const wake = day.sleepEndMinutes ?? 8 * 60;
  const hour = (offset: number) => formatClock((wake + offset * 60) % (24 * 60));
  return <section className="report-section energy-section">
    <div className="section-title compact"><div><span className="section-index">02</span><p>能量周期</p><h2>{ready ? "今天的工作节奏" : "暂不生成预测"}</h2></div><span className="estimate-badge">模型估算 · 非直接测量</span></div>
    {ready ? <><div className="energy-track"><div className="energy-zone zone-rise" style={{ width: "23%" }}><span>启动</span></div><div className="energy-zone zone-high" style={{ width: "29%" }}><span>深度工作</span></div><div className="energy-zone zone-low" style={{ width: "21%" }}><span>可能困倦</span></div><div className="energy-zone zone-mid" style={{ width: "27%" }}><span>轻任务 / 活动</span></div></div><div className="energy-times"><span>{hour(0)}</span><span>{hour(2)}</span><span>{hour(6)}</span><span>{hour(9)}</span><span>{hour(13)}</span></div><p className="model-note">基于起床时间、近 28 天睡眠覆盖、当日睡眠时长与恢复信号生成宽区间；当前把握度为有限，不代表生理能量的直接测量。</p></> : <EmptyMetric title="当前数据不足以准确估算个人能量周期" reason={`需要至少 14 个包含起床时间的有效睡眠日；当前 ${priorSleep.length} 天。`} hint="继续导入完整睡眠数据后才会启用宽区间预测。" />}
  </section>;
}

function compareTo(day: DailyHealth, history: DailyHealth[], key: keyof DailyHealth, lowerIsBetter = false) {
  const value = day[key];
  const previous = history.filter((item) => item.date < day.date && typeof item[key] === "number").at(-1)?.[key];
  const baselineValues = history.filter((item) => item.date < day.date).slice(-28).map((item) => item[key]).filter((item): item is number => typeof item === "number");
  const baseline = median(baselineValues);
  if (typeof value !== "number") return { previous: "—", baseline: "—", direction: "数据不足" };
  const delta = typeof previous === "number" ? value - previous : undefined;
  const direction = delta === undefined || Math.abs(delta) < 0.05 ? "暂无可比变化" : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)}，${(delta < 0) === lowerIsBetter ? "方向有利" : "需要结合指标语义"}`;
  return { previous: typeof previous === "number" ? previous.toFixed(1) : "—", baseline: baseline?.toFixed(1) ?? "—", direction };
}

function RecoveryPanel({ day, history, report }: { day: DailyHealth; history: DailyHealth[]; report: DailyReport }) {
  const rhr = compareTo(day, history, "restingHeartRate", true);
  const hrv = compareTo(day, history, "heartRateVariability", false);
  const baseline = history.filter((item) => item.date < day.date).slice(-28);
  const rhrState = metricState(day, baseline, "restingHeartRate");
  const hrvState = metricState(day, baseline, "heartRateVariability");
  const joint = rhrState.state === "high" && hrvState.state === "low" ? "静息心率上移且 HRV 下移，可能与恢复不足相关。" : hrvState.state === "low" && (day.sleepHours ?? 24) < 7 ? "HRV 下移并伴睡眠不足，优先检查睡眠和近期负荷。" : "当前没有出现需要突出解释的 RHR–HRV 联合模式。";
  const analysis = buildSectionNarrative("recovery", day, history, report);
  return <section className="report-section recovery-section">
    <div className="section-title compact"><div><span className="section-index">03</span><p>心血管恢复</p><h2>静息心率 × HRV</h2></div><StatusPill tone={rhrState.state === "high" || hrvState.state === "low" ? "attention" : baseline.length >= 7 ? "stable" : "limited"}>{baseline.length >= 7 ? "个人 28 天基线" : "校准中"}</StatusPill></div>
    <div className="recovery-grid">
      <article className="big-number-card accent-pink"><span>静息心率</span><strong>{formatHealthNumber("restingHeartRate", day.restingHeartRate)}<small> 次/分</small></strong><dl><div><dt>前一天</dt><dd>{rhr.previous}</dd></div><div><dt>28 天中位数</dt><dd>{rhr.baseline}</dd></div></dl></article>
      <article className="big-number-card accent-blue"><span>HRV · SDNN</span><strong>{formatHealthNumber("heartRateVariability", day.heartRateVariability)}<small> ms</small></strong><dl><div><dt>前一天</dt><dd>{hrv.previous}</dd></div><div><dt>28 天中位数</dt><dd>{hrv.baseline}</dd></div></dl></article>
      <div className="joint-analysis"><span>联合解释</span><h3>{joint}</h3><p>单次 HRV 波动不用于判断疾病。Apple Health 记录的是 SDNN，重点观察个人长期基线与趋势。</p><small>RHR 样本 {metricSamples(day, METRIC_IDS.rhr)} · HRV 样本 {metricSamples(day, METRIC_IDS.hrv)}</small></div>
    </div>
    <AnalysisBlock analysis={analysis} label="恢复解读" />
  </section>;
}

function ActivityPanel({ day, history, report }: { day: DailyHealth; history: DailyHealth[]; report: DailyReport }) {
  const analysis = buildSectionNarrative("activity", day, history, report);
  const stepProgress = Math.min(100, ((day.steps ?? 0) / 8000) * 100);
  const totalEnergy = (day.activeEnergyKcal ?? 0) + (day.basalEnergyKcal ?? 0);
  const activeShare = totalEnergy ? ((day.activeEnergyKcal ?? 0) / totalEnergy) * 100 : 0;
  const movement = [
    ["步行距离", "walkingRunningDistanceKm", day.walkingRunningDistanceKm, 8],
    ["运动时间", "exerciseMinutes", day.exerciseMinutes, 60],
    ["站立时间", "standMinutes", day.standMinutes, 120],
    ["日照时间", "timeInDaylightMinutes", day.timeInDaylightMinutes, 60],
  ] as Array<[string, HealthDisplayMetric, number | undefined, number]>;
  const gait = [
    ["步行速度", "walkingSpeed", day.walkingSpeed], ["步长", "walkingStepLengthCm", day.walkingStepLengthCm],
    ["步伐不对称", "walkingAsymmetryPercentage", day.walkingAsymmetryPercentage], ["双足支撑", "walkingDoubleSupportPercentage", day.walkingDoubleSupportPercentage],
    ["爬楼", "flightsClimbed", day.flightsClimbed],
  ] as Array<[string, HealthDisplayMetric, number | undefined]>;
  return <section className="report-section activity-section">
    <div className="section-title compact"><div><span className="section-index">04</span><p>活动与移动能力</p><h2>今天怎么动，而不只是动了多少</h2></div><span className="source-chip">{day.sources?.join(" · ") || "来源设备未记录"}</span></div>
    <div className="activity-story">
      <article className="step-portrait"><div className="step-ring" style={{ "--step-progress": `${stepProgress * 3.6}deg` } as React.CSSProperties}><div><strong>{formatHealthNumber("steps", day.steps)}</strong><span>步</span></div></div><p>8,000 步仅作为视觉参照，不是统一医学处方。</p></article>
      <article className="movement-bars"><span className="visual-label">移动构成</span>{movement.map(([label, metric, value, cap]) => <div key={label}><header><span>{label}</span><strong>{formatHealthMetric(metric, value)}</strong></header><i><b style={{ width: `${Math.min(100, ((value ?? 0) / cap) * 100)}%` }} /></i></div>)}</article>
      <article className="energy-composition"><span className="visual-label">能量构成</span><strong>{formatHealthMetric("activeEnergyKcal", day.activeEnergyKcal)}</strong><p>活动能量</p><div className="energy-stack"><i style={{ width: `${activeShare}%` }} /><b style={{ width: `${100 - activeShare}%` }} /></div><footer><span>活动 {activeShare.toFixed(0)}%</span><span>静息 {formatHealthMetric("basalEnergyKcal", day.basalEnergyKcal)}</span></footer></article>
    </div>
    <div className="gait-strip"><div><span>长期移动能力</span><p>这些指标更适合看数周变化，不用单日值贴“正常/异常”标签。</p></div>{gait.map(([label, metric, value]) => <article className={value === undefined ? "missing" : ""} key={label}><span>{label}</span><strong>{formatHealthMetric(metric, value)}</strong></article>)}</div>
    <AnalysisBlock analysis={analysis} label="活动解读" />
  </section>;
}

function VitalsPanel({ day, history, report }: { day: DailyHealth; history: DailyHealth[]; report: DailyReport }) {
  const baseline = history.filter((item) => item.date < day.date).slice(-28);
  const items: Array<{ key: "restingHeartRate" | "heartRateVariability" | "respiratoryRate" | "oxygenSaturation" | "wristTemperatureDelta" | "sleepHours"; label: string; metric: HealthDisplayMetric; value?: number }> = [
    { key: "restingHeartRate", label: "夜间/静息心率", metric: "restingHeartRate", value: day.restingHeartRate },
    { key: "heartRateVariability", label: "HRV", metric: "heartRateVariability", value: day.heartRateVariability },
    { key: "respiratoryRate", label: "呼吸频率", metric: "respiratoryRate", value: day.respiratoryRate },
    { key: "oxygenSaturation", label: "血氧趋势", metric: "oxygenSaturation", value: day.oxygenSaturation },
    { key: "wristTemperatureDelta", label: "腕温偏移", metric: "wristTemperatureDelta", value: day.wristTemperatureDelta },
    { key: "sleepHours", label: "睡眠时长", metric: "sleepHours", value: day.sleepHours },
  ];
  const states = items.map((item) => ({ item, state: metricState(day, baseline, item.key) }));
  const outliers = states.filter(({ state }) => state.state === "high" || state.state === "low").length;
  const available = states.filter(({ state }) => state.state !== "unknown").length;
  const analysis = buildSectionNarrative("vitals", day, history, report);
  return <section className="report-section vitals-section">
    <div className="section-title compact"><div><span className="section-index">05</span><p>夜间生命体征</p><h2>不是一张化验单，而是一组变化信号</h2></div></div>
    <div className="vitals-landscape">
      <article className={`vitals-summary ${outliers ? "has-outlier" : ""}`}><span>本夜组合</span><strong>{outliers || available}<small>{outliers ? " 项偏离" : " 项已比较"}</small></strong><h3>{analysis.title}</h3><p>基线来自此前最多 28 个完整日；至少 7 天才开始判断。</p></article>
      <div className="vital-signal-grid">{states.map(({ item, state }) => {
        const position = state.lower !== undefined && state.upper !== undefined && item.value !== undefined ? Math.max(2, Math.min(98, ((item.value - state.lower) / Math.max(state.upper - state.lower, 0.001)) * 100)) : 50;
        const tone = state.state === "high" || state.state === "low" ? "attention" : state.state === "unknown" ? "limited" : "stable";
        return <article className={`vital-signal signal-${tone}`} key={item.key}><header><span>{item.label}</span><StatusPill tone={tone}>{state.state === "high" ? "偏高" : state.state === "low" ? "偏低" : state.state === "typical" ? "范围内" : "校准中"}</StatusPill></header><strong>{formatHealthMetric(item.metric, item.value)}</strong><div className="personal-range"><i /><b style={{ left: `${position}%` }} /></div><footer><span>{state.lower === undefined ? "需要更多历史数据" : `个人范围 ${formatHealthNumber(item.metric, state.lower)}–${formatHealthNumber(item.metric, state.upper)}`}</span></footer></article>;
      })}</div>
    </div>
    <AnalysisBlock analysis={analysis} label="生命体征解读" />
    <div className="medical-boundary"><Icon name="shield" /><p><strong>解释边界</strong>腕温是相对个人基线的夜间偏移，不是核心体温。Apple Watch 血氧仅用于一般健身和健康理解，不能替代医用血氧仪或临床判断。</p></div>
  </section>;
}

function QualityPanel({ report, day }: { report: DailyReport; day: DailyHealth }) {
  return <section className="quality-panel"><div className="quality-ring" style={{ "--quality": `${report.dataQuality.percent * 3.6}deg` } as React.CSSProperties}><strong>{report.dataQuality.percent}%</strong><span>数据完整度</span></div><div><span className="section-index">06</span><h2>这份报告有多少依据？</h2><p>{report.dataQuality.present}/{report.dataQuality.expected} 项核心指标可用，原始聚合包含 {report.dataQuality.sampleCount.toLocaleString("zh-CN")} 条当日样本。</p><div className="quality-tags">{report.dataQuality.sources.map((source) => <span key={source}>{source}</span>)}{report.dataQuality.missing.slice(0, 6).map((item) => <span className="missing" key={item}>缺少 {item}</span>)}</div><small>缺失数据会降低结论强度；系统不会把缺失、稀疏或未授权数据补成连续读数。覆盖类别：{day.coverage.join("、") || "无"}</small></div></section>;
}

function DailyPage({ day, history, profile }: { day: DailyHealth; history: DailyHealth[]; profile: DashboardPayload["profile"] }) {
  const report = useMemo(() => buildDailyReport(day, history), [day, history]);
  const stateAge = useMemo(() => calculateStateAge(history.filter((item) => item.date <= day.date), profile), [history, day.date, profile]);
  return <div className="page daily-page page-enter" key={day.date}>
    <div className="page-kicker"><span>{formatDateLabel(day.date)}</span><i />每日身体报告</div>
    <section className="daily-hero"><div className="hero-copy"><p>今日状态</p><h1>{report.summary}</h1><div className="hero-action"><span>今天优先</span><strong>{report.nextAction}</strong></div><small>所有判断来自确定性规则与个人历史基线，不是疾病诊断。</small></div><VitalityPanel report={report} /></section>
    <div className="status-grid">{report.dimensions.map((item, index) => <article className={`status-card status-card-${item.tone}`} key={item.id}><div><span>0{index + 1}</span><i /></div><p>{item.label}</p><strong>{item.value}</strong><small>{item.detail}</small></article>)}</div>
    <SleepPanel day={day} history={history} report={report} />
    <EnergyCycle day={day} history={history} />
    <RecoveryPanel day={day} history={history} report={report} />
    <ActivityPanel day={day} history={history} report={report} />
    <VitalsPanel day={day} history={history} report={report} />
    {stateAge.status === "available" && <section className="state-age-strip"><div><span>长期状态年龄</span><strong>{stateAge.age?.toFixed(1)}<small> 岁</small></strong></div><p>{stateAge.difference && stateAge.difference < 0 ? `比实际年龄年轻 ${Math.abs(stateAge.difference).toFixed(1)} 岁` : `与实际年龄差 ${stateAge.difference?.toFixed(1) ?? "—"} 岁`}<small>FRIEND 心肺适能人群曲线锚定；0.1 岁仅为显示分辨率。</small></p><span>把握度 {stateAge.confidence}</span></section>}
    <QualityPanel report={report} day={day} />
  </div>;
}

function chartOption(days: DailyHealth[], key: keyof DailyHealth, metric: HealthDisplayMetric, label: string, color: string) {
  const values = days.map((day) => typeof day[key] === "number" ? day[key] as number : null);
  const rolling = days.map((_, index) => median(values.slice(Math.max(0, index - 6), index + 1).filter((value): value is number => value !== null)) ?? null);
  return {
    animationDuration: 600,
    color: [color, "#aeb5c0"],
    tooltip: { trigger: "axis", backgroundColor: "#090a1e", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12, fontFamily: "Microsoft YaHei UI" } },
    legend: { data: [label, "7 日中位趋势"], top: 0, right: 4, itemGap: 18, textStyle: { color: "#596373", fontSize: 11, fontFamily: "Microsoft YaHei UI" } },
    grid: { left: 48, right: 20, top: 42, bottom: 48 },
    xAxis: { type: "category", data: days.map((day) => day.date.slice(5)), boundaryGap: false, axisLine: { lineStyle: { color: "#dfe3e8" } }, axisLabel: { color: "#697383", fontSize: 11, fontFamily: "Microsoft YaHei UI" } },
    yAxis: { type: "value", scale: true, axisLabel: { color: "#697383", fontSize: 11, fontFamily: "Microsoft YaHei UI" }, splitLine: { lineStyle: { color: "#eef0f3" } } },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 13, bottom: 8, borderColor: "transparent", backgroundColor: "#f1f3f6", fillerColor: "rgba(40,103,240,.14)", showDetail: false }],
    toolbox: { right: 0, top: 22, feature: { saveAsImage: { title: "导出图片", pixelRatio: 2 } }, iconStyle: { borderColor: "#8b919c" } },
    series: [
      { name: label, type: "line", data: values, connectNulls: false, symbol: "circle", symbolSize: 5, lineStyle: { width: 1.5 }, itemStyle: { color }, tooltip: { valueFormatter: (value: unknown) => formatHealthMetric(metric, value) } },
      { name: "7 日中位趋势", type: "line", data: rolling, connectNulls: false, showSymbol: false, lineStyle: { width: 2.5, color: "#090a1e" }, tooltip: { valueFormatter: (value: unknown) => formatHealthMetric(metric, value) } },
    ],
  };
}

function TrendCard({ days, dataKey, metric, label, subtitle, color }: { days: DailyHealth[]; dataKey: "restingHeartRate" | "heartRateVariability" | "sleepHours" | "activeEnergyKcal"; metric: HealthDisplayMetric; label: string; subtitle: string; color: string }) {
  const analysis = buildTrendNarrative(days, dataKey, metric, label);
  return <article className={`trend-card trend-${analysis.tone}`}><header><div><h3>{label}</h3><p>{subtitle}</p></div><span>{analysis.sampleCount} 个有效日</span></header><ReactECharts option={chartOption(days, dataKey, metric, label, color)} style={{ height: 280 }} /><div className="chart-facts"><span>最近 {analysis.latest}</span><span>窗口中位数 {analysis.windowMedian}</span><span>范围 {analysis.range}</span></div><AnalysisBlock analysis={analysis} label="图表解读" /></article>;
}

function InsightCard({ insight }: { insight: HealthInsight }) {
  return <details className={`insight-card severity-${insight.severity}`} open={insight.severity === "important"}><summary><span>{insight.severity === "important" ? "优先" : insight.severity === "attention" ? "关注" : "观察"}</span><div><small>{insight.dateRange} · 证据把握 {insight.confidence}</small><h3>{insight.title}</h3><p>{insight.summary}</p></div><Icon name="chevron" /></summary><div className="insight-body"><div className="evidence-list">{insight.evidence.map((item, index) => <article key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong><small>{item.comparison}</small></article>)}</div><div className="explanation-grid">{insight.explanations.map((item) => <article key={item.title}><span>{item.fit}</span><strong>{item.title}</strong><p>{item.rationale}</p></article>)}</div><div className="action-line"><strong>下一步</strong><p>{insight.actions[0]}</p></div><small className="limitation">不能推断因果：{insight.limitation}</small></div></details>;
}

function InsightsPage({ days, selectedDate, period, setPeriod }: { days: DailyHealth[]; selectedDate: string; period: PeriodDays; setPeriod: (period: PeriodDays) => void }) {
  const history = days.filter((day) => day.complete && day.date <= selectedDate);
  const window = history.slice(-period);
  const insights = deriveHealthInsights(history, period);
  const lateNights = window.filter((day, index) => { const prior = history.filter((item) => item.date < day.date).slice(-28); const center = median(prior.map((item) => item.sleepStartMinutes).filter((value): value is number => typeof value === "number").map((value) => value < 720 ? value + 1440 : value)); const current = day.sleepStartMinutes === undefined ? undefined : day.sleepStartMinutes < 720 ? day.sleepStartMinutes + 1440 : day.sleepStartMinutes; return current !== undefined && center !== undefined && current - center >= 60 && (day.sleepHours ?? 24) < 7.5; });
  return <div className="page insights-page page-enter"><div className="page-heading"><div><span>Patterns, not guesses</span><h1>洞察</h1><p>把变化、可能解释和不能确定的部分放在同一张证据卡里。</p></div><div className="range-switch">{([7, 30, 90, 180, 365] as PeriodDays[]).map((value) => <button className={period === value ? "active" : ""} key={value} onClick={() => setPeriod(value)}>{value === 180 ? "6 月" : value === 365 ? "1 年" : `${value} 天`}</button>)}</div></div>
    <section className="insight-overview"><div><span>当前窗口</span><strong>{window.length}<small> 个有效日</small></strong><p>{window.at(0)?.date ?? "—"} — {window.at(-1)?.date ?? "—"}</p></div><div className="accent-pink"><span>识别到的作息后移</span><strong>{lateNights.length}<small> 次</small></strong><p>同时满足相对个人基线后移与睡眠不足</p></div><div className="accent-blue"><span>优先洞察</span><strong>{insights.filter((item) => item.severity === "important" || item.severity === "attention").length}<small> 条</small></strong><p>严重度来自多指标组合，不是单次读数</p></div></section>
    <section className="insight-list">{insights.slice(0, 5).map((insight) => <InsightCard insight={insight} key={insight.id} />)}</section>
    <div className="section-divider"><span>趋势证据</span><p>原始日数据 + 7 日中位趋势；缺失日保持断点。</p></div>
    <section className="trend-grid"><TrendCard days={window} dataKey="restingHeartRate" metric="restingHeartRate" label="静息心率" subtitle="次/分 · 与 HRV 和睡眠共同解释" color="#f653b7" /><TrendCard days={window} dataKey="heartRateVariability" metric="heartRateVariability" label="HRV · SDNN" subtitle="ms · 重点观察个人长期趋势" color="#2867f0" /><TrendCard days={window} dataKey="sleepHours" metric="sleepHours" label="睡眠时长" subtitle="小时 · 与作息时点和恢复信号交叉验证" color="#5637bb" /><TrendCard days={window} dataKey="activeEnergyKcal" metric="activeEnergyKcal" label="活动能量" subtitle="千卡 · 与运动分钟、步数和恢复共同解释" color="#53b94c" /></section>
    <div className="correlation-boundary"><Icon name="warning" /><p><strong>关联分析门槛</strong>只有同一粒度的有效配对达到 12 天才绘制散点；少于 8 天不生成关联结论。相关不等于因果。</p></div>
  </div>;
}

function AdvicePage({ day, history }: { day: DailyHealth; history: DailyHealth[] }) {
  const report = buildDailyReport(day, history);
  const advice = buildClinicalAdvice(day, history, report);
  return <div className="page advice-page page-enter">
    <div className="page-heading"><div><span>Clinical reasoning, not diagnosis</span><h1>建议</h1><p>从个人数据出发，说明支持证据、待排原因、执行方案、复查节点和就医条件。</p></div><div className="evidence-status"><Icon name="check" /><span>仅 A/B 级证据形成行动建议</span></div></div>
    <section className="advice-brief"><div><span>今日处理顺序</span><h2>{advice[0]?.title}</h2><p>先处理高风险和可逆因素，再观察趋势；一次最多三项，避免同时改变太多变量。</p></div><strong>{advice.length}<small> 项计划</small></strong></section>
    <div className="advice-list">{advice.map((item) => {
      const sources = item.sourceIds.map((id) => KNOWLEDGE_SOURCES.find((source) => source.id === id)).filter(Boolean);
      return <article className={`advice-card advice-${item.tone}`} key={item.title}>
        <div className="advice-number">0{item.rank}</div>
        <div className="advice-main"><span>{item.category}</span><h2>{item.title}</h2><p className="clinical-summary">{item.clinicalSummary}</p>
          <div className="observation-strip">{item.observations.map((observation) => <span key={observation}>{observation}</span>)}</div>
          <div className="reasoning-grid">{item.reasoning.map((reason) => <article key={reason.label}><small>{reason.label}</small><p>{reason.text}</p></article>)}</div>
          <div className="care-plan"><h3>恢复与复查计划</h3>{item.plan.map((step) => <div key={`${step.when}-${step.action}`}><span>{step.when}</span><p>{step.action}</p></div>)}</div>
          <div className="monitor-row"><strong>观察指标</strong>{item.monitor.map((metric) => <span key={metric}>{metric}</span>)}</div>
          <div className="safety-grid"><article><small>复查节点</small><p>{item.reviewAfter}</p></article><article><small>停止条件</small><p>{item.stop}</p></article><article className="seek-care"><small>何时就医</small><p>{item.seekCare}</p></article></div>
        </div>
        <aside><span className="grade">证据 {item.grade}</span><strong>依据与边界</strong>{sources.map((source) => <a href={source!.url} target="_blank" rel="noreferrer" key={source!.id}><span>{source!.organization}</span><p>{source!.title}</p></a>)}<small>这是基于可穿戴数据的健康管理推理，不是诊断、处方或个体化医疗行为。</small></aside>
      </article>;
    })}</div>
    <div className="medical-boundary strong"><Icon name="shield" /><p><strong>医疗安全边界</strong>{SAFETY_COPY.nonDiagnosis} {SAFETY_COPY.emergency}</p></div>
  </div>;
}

const HEALTHKIT_MAP = [
  ["睡眠阶段", "SleepAnalysis", "Apple Watch / iPhone", "区间去重"], ["心率", "HeartRate", "Apple Watch", "分时样本"], ["HRV", "HeartRateVariabilitySDNN", "Apple Watch", "SDNN 日聚合"],
  ["血氧", "OxygenSaturation", "受机型与地区限制", "日中位数"], ["腕温", "AppleSleepingWristTemperature", "支持机型", "相对个人基线"], ["活动能量", "ActiveEnergyBurned", "多设备", "统一千卡后求和"],
  ["步伐不对称", "WalkingAsymmetryPercentage", "通常 iPhone", "日中位数"], ["日照", "TimeInDaylight", "支持设备", "分钟求和"],
];

function DataPage({ dashboard, day, onImport, onExport, onDeleteDate, onDeleteMetric, onDeleteAll }: {
  dashboard: DashboardPayload; day: DailyHealth; onImport: () => void; onExport: () => void;
  onDeleteDate: () => void; onDeleteMetric: (metric: string) => void; onDeleteAll: () => void;
}) {
  const [selectedMetric, setSelectedMetric] = useState(Object.keys(day.sampleCounts ?? {})[0] ?? "");
  const report = buildDailyReport(day, dashboard.days);
  const samples = Object.entries(day.sampleCounts ?? {}).sort((a, b) => b[1] - a[1]);
  return <div className="page data-page page-enter"><div className="page-heading"><div><span>Local data provenance</span><h1>数据</h1><p>查看导入、来源、覆盖和缺失；原始健康数据默认只保存在本机。</p></div><button className="primary-action" onClick={onImport}><Icon name="import" />导入新的 Apple 健康数据</button></div><section className="data-summary"><div><span>历史覆盖</span><strong>{dashboard.historyDays}<small> 天</small></strong><p>{dashboard.days.at(0)?.date ?? "—"} — {dashboard.importSummary?.lastCompleteDate ?? "—"}</p></div><div><span>最近导入记录</span><strong>{dashboard.importSummary?.recordsSeen.toLocaleString("zh-CN") ?? "—"}<small> 条</small></strong><p>{dashboard.importSummary?.fileName ?? "尚未导入"}</p></div><div><span>当日样本</span><strong>{report.dataQuality.sampleCount.toLocaleString("zh-CN")}<small> 条</small></strong><p>{report.dataQuality.sources.join(" · ") || "来源未记录"}</p></div><div><span>重复导入</span><strong>{dashboard.importSummary?.recordsUpdated.toLocaleString("zh-CN") ?? "0"}<small> 条复核</small></strong><p>按记录指纹增量去重</p></div></section><section className="data-workspace"><article><div className="subheading"><div><span>当前日期</span><h2>样本与来源</h2></div><strong>{day.date}</strong></div>{samples.length ? <div className="sample-list">{samples.slice(0, 14).map(([type, count]) => <div key={type}><span>{type.replace("HKQuantityTypeIdentifier", "").replace("HKCategoryTypeIdentifier", "")}</span><strong>{count.toLocaleString("zh-CN")}</strong></div>)}</div> : <EmptyMetric title="没有样本计数" reason="这批数据由旧版本聚合，重新导入同一 ZIP 后可补充来源与样本数。" hint="原始记录不会重复写入。" />}</article><article><div className="subheading"><div><span>数据质量</span><h2>可以分析什么</h2></div><strong>{report.dataQuality.percent}%</strong></div><div className="quality-bars"><div><span>核心指标</span><i><b style={{ width: `${report.dataQuality.percent}%` }} /></i><small>{report.dataQuality.present}/{report.dataQuality.expected}</small></div><div><span>个人基线</span><i><b style={{ width: `${Math.min(dashboard.historyDays / 28, 1) * 100}%` }} /></i><small>{Math.min(dashboard.historyDays, 28)}/28 天</small></div></div><p className="model-note">缺少：{report.dataQuality.missing.join("、") || "无"}。仍可分析已有数据，但结论强度会自动降低。</p></article></section><section className="mapping-section"><div className="subheading"><div><span>HealthKit mapping</span><h2>数据类型映射</h2></div><p>未知类型仍保留在本地原始记录表中。</p></div><div className="mapping-table"><div><span>产品指标</span><span>HealthKit 类型</span><span>常见来源</span><span>聚合</span></div>{HEALTHKIT_MAP.map((row) => <div key={row[0]}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>)}</div></section><section className="data-actions"><div><span>Local data controls</span><h2>导出与删除</h2><p>所有操作只发生在本机。删除后无法由软件恢复，请先导出 CSV 备份。</p></div><div className="action-controls"><button onClick={onExport}>导出全部 CSV</button><button className="danger-soft" onClick={onDeleteDate}>删除 {day.date}</button><label><select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>{samples.map(([metric]) => <option value={metric} key={metric}>{metric.replace("HKQuantityTypeIdentifier", "").replace("HKCategoryTypeIdentifier", "")}</option>)}</select><button disabled={!selectedMetric} className="danger-soft" onClick={() => onDeleteMetric(selectedMetric)}>删除该指标</button></label><button className="danger" onClick={onDeleteAll}>删除全部健康数据</button></div></section></div>;
}

function SettingsPage() {
  return <div className="page settings-page page-enter"><div className="page-heading"><div><span>Privacy & methodology</span><h1>设置</h1><p>不是功能开关的堆积，而是把数据去向、分析边界和证据来源说清楚。</p></div></div><section className="settings-grid"><article className="privacy-card"><div className="subheading"><div><span>默认策略</span><h2>本地优先</h2></div><Icon name="shield" /></div>{[["原始健康数据", "仅本机 SQLite", true], ["云同步", "未提供", true], ["广告与数据交易", "不使用", true]].map(([label, detail]) => <div className="setting-row" key={String(label)}><div><strong>{label}</strong><small>{detail}</small></div><span className="readonly-toggle on"><i /></span></div>)}<p>应用不会把逐条健康数据发送到外部服务。只有在用户主动打开权威资料链接时，系统浏览器才会访问对应网站。</p></article><article className="method-card-v3"><div className="subheading"><div><span>确定性分析</span><h2>规则先于语言</h2></div><span className="version-chip">rules 1.0</span></div><ol><li><strong>数据层</strong><span>清洗、单位转换、去重、时间对齐和逐日聚合</span></li><li><strong>基线层</strong><span>前 14 天校准，28 个有效日形成滚动中位数与 MAD</span></li><li><strong>规则层</strong><span>数据质量门、单指标偏离、多指标组合和风险动作</span></li><li><strong>语言层</strong><span>只解释已计算结果，不创建阈值、不诊断疾病</span></li></ol></article></section><section className="evidence-library"><div className="subheading"><div><span>Evidence library</span><h2>当前证据库</h2></div><p>{KNOWLEDGE_SOURCES.length} 条可追溯来源</p></div><div>{KNOWLEDGE_SOURCES.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span>{source.organization}</span><strong>{source.title}</strong><small>{source.use}</small></a>)}</div></section><div className="medical-boundary strong"><Icon name="shield" /><p><strong>安全边界</strong>{SAFETY_COPY.sensor} {SAFETY_COPY.nonDiagnosis}</p></div></div>;
}

function EmptyDay({ date }: { date: string }) {
  return <div className="page empty-day page-enter"><span><Icon name="calendar" /></span><h1>{formatDateLabel(date)} 没有可用记录</h1><p>可能是当天没有佩戴、设备未授权、数据尚未导出，或该日期超出当前导入范围。</p><div><strong>当前仍可做什么</strong><span>切换到有数据的日期</span><span>查看数据覆盖与来源</span><span>导入更新后的 Apple 健康 ZIP</span></div></div>;
}

function EmptyApp({ onImport, dragging }: { onImport: () => void; dragging: boolean }) {
  return <main className={`empty-app ${dragging ? "dragging" : ""}`}><div className="empty-prism"><i /><i /><i /></div><span>Apple 健康，本机解析</span><h1>{dragging ? "松开即可导入" : "把分散的数据，整理成可以行动的身体报告。"}</h1><p>导入 Apple 健康的 export.zip。软件会在本机建立个人基线，解释睡眠、恢复、活动和生命体征之间的关系。</p><button onClick={onImport}><Icon name="import" />选择 export.zip</button><div><span><Icon name="shield" />不上传云端</span><span>增量去重</span><span>不伪造缺失数据</span></div></main>;
}

function ImportOverlay({ progress }: { progress: ImportProgress }) {
  return <div className="import-overlay"><div><span className="loader" /><section><small>正在本机处理 · {Math.round(progress.percent)}%</small><h2>{progress.message}</h2><p>{progress.recordsProcessed ? `已读取 ${progress.recordsProcessed.toLocaleString("zh-CN")} 条记录` : "正在验证文件结构与安全限制"}</p></section></div></div>;
}

export default function AppV3() {
  const [dashboard, setDashboard] = useState<DashboardPayload>(EMPTY_DASHBOARD);
  const [activeView, setActiveView] = useState<AppView>("daily");
  const [selectedDate, setSelectedDate] = useState("");
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const days = useMemo(() => dashboard.days.filter((day) => day.complete).sort((a, b) => a.date.localeCompare(b.date)), [dashboard.days]);
  const earliest = days.at(0)?.date ?? "";
  const latest = dashboard.importSummary?.lastCompleteDate ?? days.at(-1)?.date ?? "";
  const selectedDay = days.find((day) => day.date === selectedDate);

  const loadDashboard = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = await invoke<DashboardPayload>("load_dashboard");
    setDashboard(payload);
    setSelectedDate((current) => current || payload.importSummary?.lastCompleteDate || payload.days.filter((day) => day.complete).at(-1)?.date || "");
  }, []);

  const importPath = useCallback(async (path: string) => {
    if (!isTauri()) { setError("当前为浏览器预览，只有桌面版可以读取本机健康文件。"); return; }
    setError(null); setProgress({ phase: "validating", percent: 1, message: "正在验证 Apple 健康导出" });
    try { const { invoke } = await import("@tauri-apps/api/core"); const payload = await invoke<DashboardPayload>("import_health_export", { path }); setDashboard(payload); setSelectedDate(payload.importSummary?.lastCompleteDate || payload.days.filter((day) => day.complete).at(-1)?.date || ""); setActiveView("daily"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setProgress(null); }
  }, []);

  const chooseImport = useCallback(async () => {
    if (!isTauri()) { setError("当前为浏览器预览。请运行桌面版后导入 ZIP。"); return; }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, directory: false, filters: [{ name: "Apple 健康导出", extensions: ["zip", "xml"] }] });
    if (typeof path === "string") await importPath(path);
  }, [importPath]);

  const exportData = useCallback(async () => {
    if (!isTauri()) return;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: `知衡健康-原始数据-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const count = await invoke<number>("export_health_data", { path });
    setNotice(`已在本机导出 ${count.toLocaleString("zh-CN")} 条记录。`);
  }, []);

  const mutateData = useCallback(async (command: string, args: Record<string, string>, confirmation: string) => {
    if (!window.confirm(confirmation) || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = await invoke<DashboardPayload>(command, args);
    setDashboard(payload);
    const nextDate = payload.importSummary?.lastCompleteDate || payload.days.filter((item) => item.complete).at(-1)?.date || "";
    if (!payload.days.some((item) => item.date === selectedDate)) setSelectedDate(nextDate);
    setNotice("本地数据操作已完成。");
  }, [selectedDate]);

  useEffect(() => {
    loadDashboard().catch((cause) => setError(String(cause)));
    if (!isTauri()) return;
    let removeProgress: (() => void) | undefined; let removeDrag: (() => void) | undefined;
    void (async () => { const { listen } = await import("@tauri-apps/api/event"); const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow"); removeProgress = await listen<ImportProgress>("import-progress", (event) => setProgress(event.payload)); removeDrag = await getCurrentWebviewWindow().onDragDropEvent((event) => { if (event.payload.type === "over") setDragging(true); if (event.payload.type === "leave") setDragging(false); if (event.payload.type === "drop") { setDragging(false); const healthFile = event.payload.paths.find((path) => /\.(zip|xml)$/i.test(path)); if (healthFile) void importPath(healthFile); else setError("请拖入 Apple 健康导出的 export.zip 或 export.xml。"); } }); })().catch((cause) => setError(String(cause)));
    return () => { removeProgress?.(); removeDrag?.(); };
  }, [importPath, loadDashboard]);

  return <div className="v3-shell"><Sidebar active={activeView} onNavigate={setActiveView} /><div className="workspace">{days.length > 0 && <HeaderBar selectedDate={selectedDate || latest} earliest={earliest} latest={latest} day={selectedDay} dashboard={dashboard} onDateChange={setSelectedDate} onImport={chooseImport} />}{error && <div className="error-toast"><Icon name="warning" /><div><strong>暂时无法继续</strong><span>{error}</span></div><button onClick={() => setError(null)}>×</button></div>}{notice && <div className="success-toast"><Icon name="check" /><span>{notice}</span><button onClick={() => setNotice(null)}>×</button></div>}{days.length === 0 ? <EmptyApp onImport={chooseImport} dragging={dragging} /> : !selectedDay ? <EmptyDay date={selectedDate} /> : activeView === "daily" ? <DailyPage day={selectedDay} history={days} profile={dashboard.profile} /> : activeView === "insights" ? <InsightsPage days={days} selectedDate={selectedDate} period={period} setPeriod={setPeriod} /> : activeView === "advice" ? <AdvicePage day={selectedDay} history={days} /> : activeView === "data" ? <DataPage dashboard={dashboard} day={selectedDay} onImport={chooseImport} onExport={() => void exportData().catch((cause) => setError(String(cause)))} onDeleteDate={() => void mutateData("delete_health_date", { date: selectedDate }, `确定删除 ${selectedDate} 的全部健康记录吗？此操作无法撤销。`).catch((cause) => setError(String(cause)))} onDeleteMetric={(typeIdentifier) => void mutateData("delete_health_metric", { typeIdentifier }, `确定删除 ${typeIdentifier} 的全部记录吗？此操作无法撤销。`).catch((cause) => setError(String(cause)))} onDeleteAll={() => void mutateData("delete_all_health_data", {}, "确定删除本机保存的全部健康数据吗？此操作无法撤销。").catch((cause) => setError(String(cause)))} /> : <SettingsPage />}</div>{progress && <ImportOverlay progress={progress} />}</div>;
}
