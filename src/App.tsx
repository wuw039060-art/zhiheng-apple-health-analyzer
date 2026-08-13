/* Legacy V2 implementation retained below for migration reference. */
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { buildMetricCards, deriveHealthInsights, metricState } from "./domain/analytics";
import { formatHealthMetric } from "./domain/format";
import { calculateStateAge } from "./domain/stateAge";
import { KNOWLEDGE_SOURCES, SAFETY_COPY } from "./domain/knowledge";
import type {
  DashboardPayload,
  HealthInsight,
  ImportProgress,
  PeriodDays,
  StateAgeResult,
} from "./domain/types";

const EMPTY_DASHBOARD: DashboardPayload = { days: [], historyDays: 0 };
type AppView = "overview" | "insights" | "trends" | "state-age" | "methodology";

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

function Icon({ name }: { name: "heart" | "chart" | "import" | "shield" | "book" | "moon" | "activity" | "pulse" | "trend" | "spark" }) {
  const paths = {
    heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6a5.5 5.5 0 0 0 1-8.8Z",
    chart: "M4 19V9m6 10V5m6 14v-7m4 7H2",
    import: "M12 3v12m0 0 5-5m-5 5-5-5M5 21h14",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-5",
    book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Zm0 0A2.5 2.5 0 0 0 6.5 22H20",
    moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z",
    activity: "M4 13h3l2-6 4 12 2-6h5",
    pulse: "M3 12h4l2.5-6 4.5 12 2.5-6H21",
    trend: "M4 17l5-5 4 3 7-8m-5 0h5v5",
    spark: "m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z",
  } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

function EmptyState({ onImport, dragActive }: { onImport: () => void; dragActive: boolean }) {
  return (
    <section className={`empty-state ${dragActive ? "is-dragging" : ""}`}>
      <div className="empty-orbit"><span /></div>
      <p className="eyebrow">全部在本机处理</p>
      <h1>{dragActive ? "松开即可导入" : "读懂你的 Apple 健康趋势"}</h1>
      <p className="empty-copy">
        拖入 Apple 健康导出的 ZIP，软件会直接读取压缩包、增量去重，并用睡眠、心率、HRV、呼吸、血氧和活动数据交叉解释近期变化。
      </p>
      <button className="primary-button" onClick={onImport}>
        <Icon name="import" />选择健康数据 ZIP
      </button>
      <div className="privacy-row">
        <span><Icon name="shield" />不上传云端</span>
        <span>不解压到临时目录</span>
        <span>支持重复导入完整快照</span>
      </div>
    </section>
  );
}

function ImportOverlay({ progress }: { progress: ImportProgress }) {
  return (
    <div className="import-overlay" role="status" aria-live="polite">
      <div className="import-card">
        <div className="progress-ring" style={{ "--progress": `${progress.percent * 3.6}deg` } as React.CSSProperties}>
          <strong>{Math.round(progress.percent)}%</strong>
        </div>
        <div>
          <p className="eyebrow">正在本机处理</p>
          <h2>{progress.message}</h2>
          <p>{progress.recordsProcessed ? `已读取 ${progress.recordsProcessed.toLocaleString()} 条记录` : "正在验证压缩包结构与数据安全性"}</p>
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: HealthInsight }) {
  const [expanded, setExpanded] = useState(insight.severity === "important" || insight.severity === "attention");
  const labels = { important: "优先关注", attention: "建议关注", notice: "持续观察", info: "信息" };
  return (
    <article className={`insight-card severity-${insight.severity}`}>
      <button className="insight-heading" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="severity-dot" />
        <span className="insight-title-wrap">
          <span className="insight-meta">{labels[insight.severity]} · 证据把握 {insight.confidence}</span>
          <strong>{insight.title}</strong>
          <small>{insight.dateRange}</small>
        </span>
        <span className="chevron">{expanded ? "−" : "+"}</span>
      </button>
      <p className="insight-summary">{insight.summary}</p>
      {expanded && (
        <div className="insight-detail">
          {insight.evidence.length > 0 && (
            <div>
              <h4>交叉证据</h4>
              <div className="evidence-grid">
                {insight.evidence.map((item, index) => (
                  <div className={`evidence evidence-${item.state}`} key={`${item.label}-${index}`}>
                    <span>{item.label}</span><strong>{item.value}</strong><small>{item.comparison}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
          {insight.explanations.length > 0 && (
            <div>
              <h4>可能解释，不是诊断</h4>
              <div className="explanation-list">
                {insight.explanations.map((item) => (
                  <div key={item.title}>
                    <span>{item.fit}</span><strong>{item.title}</strong><p>{item.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <h4>建议下一步</h4>
            <ul>{insight.actions.map((action) => <li key={action}>{action}</li>)}</ul>
          </div>
          <p className="limitation">边界：{insight.limitation}</p>
        </div>
      )}
    </article>
  );
}

function DailyBrief({ days, insights }: { days: DashboardPayload["days"]; insights: HealthInsight[] }) {
  const latest = days.at(-1);
  if (!latest) return null;
  const baseline = days.filter((day) => day.date < latest.date).slice(-28);
  const sleepState = metricState(latest, baseline, "sleepHours");
  const hrvState = metricState(latest, baseline, "heartRateVariability");
  const rhrState = metricState(latest, baseline, "restingHeartRate");
  const primary = insights.find((item) => item.severity === "important")
    ?? insights.find((item) => item.severity === "attention")
    ?? insights.find((item) => item.severity === "notice");
  const stateLabel = (state: ReturnType<typeof metricState>) => {
    if (state.state === "typical") return "个人范围内";
    if (state.state === "high") return "高于个人范围";
    if (state.state === "low") return "低于个人范围";
    return "基线建立中";
  };
  const recoveryAttention = [hrvState.state, rhrState.state].some((state) => state === "high" || state === "low");
  const pillars = [
    {
      id: "sleep",
      icon: "moon" as const,
      label: "昨夜睡眠",
      value: formatHealthMetric("sleepHours", latest.sleepHours),
      note: stateLabel(sleepState),
      tone: sleepState.state === "high" || sleepState.state === "low" || (latest.sleepHours ?? 8) < 7 ? "attention" : "good",
    },
    {
      id: "recovery",
      icon: "pulse" as const,
      label: "恢复信号",
      value: latest.heartRateVariability === undefined ? "—" : `HRV ${formatHealthMetric("heartRateVariability", latest.heartRateVariability)}`,
      note: latest.restingHeartRate === undefined ? stateLabel(hrvState) : `静息心率 ${formatHealthMetric("restingHeartRate", latest.restingHeartRate)}`,
      tone: recoveryAttention ? "attention" : "good",
    },
    {
      id: "activity",
      icon: "activity" as const,
      label: "今日活动",
      value: formatHealthMetric("exerciseMinutes", latest.exerciseMinutes),
      note: latest.steps === undefined ? "锻炼记录" : formatHealthMetric("steps", latest.steps),
      tone: latest.exerciseMinutes === undefined ? "neutral" : latest.exerciseMinutes >= 30 ? "good" : "neutral",
    },
  ];
  return (
    <section className={`daily-brief ${primary ? `brief-${primary.severity}` : "brief-stable"}`} id="overview">
      <div className="daily-focus">
        <div className="focus-label"><Icon name="spark" /><span>{primary ? "今天先看" : "今日状态"}</span></div>
        <h2>{primary?.title ?? "近期身体信号整体平稳"}</h2>
        <p>{primary?.summary ?? "目前没有发现需要优先处理的多指标异常组合。继续观察个人趋势即可。"}</p>
        <div className="focus-action"><strong>建议</strong><span>{primary?.actions[0] ?? "保持规律睡眠和日常活动，等待下一次数据更新。"}</span></div>
        <small>基于 {latest.date} 的最近完整日 · 结论用于自我观察，不替代诊断</small>
      </div>
      <div className="daily-pillars">
        <div className="pillar-heading"><span>三个维度</span><small>睡眠 · 恢复 · 活动</small></div>
        {pillars.map((pillar) => (
          <article className={`pillar-card pillar-${pillar.tone}`} key={pillar.id}>
            <span className="pillar-icon"><Icon name={pillar.icon} /></span>
            <div><small>{pillar.label}</small><strong>{pillar.value}</strong><em>{pillar.note}</em></div>
            <i />
          </article>
        ))}
      </div>
    </section>
  );
}

function HealthMonitor({ days }: { days: DashboardPayload["days"] }) {
  const latest = days.at(-1);
  if (!latest) return null;
  const baseline = days.filter((day) => day.date < latest.date).slice(-28);
  const definitions = [
    { key: "restingHeartRate" as const, label: "静息心率" },
    { key: "heartRateVariability" as const, label: "HRV" },
    { key: "respiratoryRate" as const, label: "呼吸频率" },
    { key: "oxygenSaturation" as const, label: "血氧趋势" },
    { key: "wristTemperatureDelta" as const, label: "腕温偏移" },
  ];
  const signals = definitions.map((definition) => ({
    ...definition,
    analysis: metricState(latest, baseline, definition.key),
    value: latest[definition.key],
  }));
  const attentionCount = signals.filter(({ analysis }) => analysis.state === "high" || analysis.state === "low").length;
  const typicalCount = signals.filter(({ analysis }) => analysis.state === "typical").length;
  const statusLabel = (state: ReturnType<typeof metricState>["state"]) => ({
    typical: "个人范围内",
    high: "偏高",
    low: "偏低",
    unknown: "数据不足",
  }[state]);
  return (
    <section className="health-monitor">
      <div className="monitor-heading">
        <div><p className="eyebrow">最近完整日</p><h2>生命体征</h2></div>
        <span className={attentionCount ? "monitor-attention" : "monitor-stable"}>
          <i />{attentionCount ? `${attentionCount} 项需要留意` : typicalCount ? `${typicalCount} 项处于个人范围` : "正在建立个人基线"}
        </span>
      </div>
      <div className="monitor-grid">
        {signals.map(({ key, label, analysis, value }) => (
          <article className={`monitor-card signal-${analysis.state}`} key={key}>
            <div><span>{label}</span><i /></div>
            <strong>{formatHealthMetric(key, value)}</strong>
            <p>{statusLabel(analysis.state)}</p>
            <small>{analysis.median === undefined ? `${analysis.samples}/7 天基线数据` : `个人中位数 ${formatHealthMetric(key, analysis.median)}`}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function StateAgePreview({ result, onOpen }: { result: StateAgeResult; onOpen: () => void }) {
  if (result.status === "insufficient-data") {
    return (
      <section className="state-age-preview state-age-preview-empty">
        <div><p className="eyebrow">长期状态</p><h2>状态年龄仍在建立</h2><p>继续导入完整数据后，这里会显示身体状态对应的年龄区间。</p></div>
        <button onClick={onOpen}>查看缺少的数据</button>
      </section>
    );
  }
  const difference = result.difference ?? 0;
  return (
    <section className="state-age-preview">
      <div className="preview-age"><strong>{result.age?.toFixed(1)}</strong><span>岁</span></div>
      <div>
        <p className="eyebrow">长期状态 · 30 天</p>
        <h2>{difference < 0 ? `比实际年龄年轻 ${Math.abs(difference).toFixed(1)} 岁` : difference > 0 ? `比实际年龄偏高 ${difference.toFixed(1)} 岁` : "与实际年龄基本一致"}</h2>
        <p>合理区间 {result.lower?.toFixed(1)}–{result.upper?.toFixed(1)} 岁 · 把握度 {result.confidence}</p>
      </div>
      <button onClick={onOpen}>查看计算依据 <span>›</span></button>
    </section>
  );
}

function StateAgePanel({ result }: { result: StateAgeResult }) {
  if (result.status === "insufficient-data") {
    return (
      <section className="state-age-card state-age-empty">
        <div>
          <p className="eyebrow">状态年龄 · 30 天模型</p>
          <h2>暂不生成年龄</h2>
          <p>还缺少：{result.missing.join("、")}。数据不足时不使用静息心率或 HRV 猜测年龄。</p>
        </div>
        <span className="model-chip">{result.modelVersion}</span>
      </section>
    );
  }
  const modifiers = result.components.filter((item) => item.role === "modifier");
  const contexts = result.components.filter((item) => item.role === "context-only");
  const anchor = result.components.find((item) => item.role === "age-anchor");
  const ageDifference = result.difference ?? 0;
  const comparison = ageDifference < -0.05
    ? `比实际年龄年轻 ${Math.abs(ageDifference).toFixed(1)} 岁`
    : ageDifference > 0.05
      ? `比实际年龄偏高 ${ageDifference.toFixed(1)} 岁`
      : "与实际年龄基本一致";
  return (
    <section className="state-age-card" id="state-age">
      <div className="state-age-hero">
        <div className="state-age-ring" style={{ "--age-progress": `${result.confidenceScore * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{result.age?.toFixed(1)}</strong><span>岁</span><small>状态年龄</small></div>
        </div>
        <div className="state-age-copy">
          <p className="eyebrow">长期状态 · 最近 30 个完整日</p>
          <h2>{comparison}</h2>
          <p>综合心肺适能、运动后恢复、活动、静息心率、HRV 与睡眠等信号。合理波动区间约 {result.lower?.toFixed(1)}–{result.upper?.toFixed(1)} 岁。</p>
          <div className="age-chips">
            <span>实际年龄 {result.chronologicalAge?.toFixed(1)} 岁</span>
            <span className={ageDifference > 0 ? "age-up" : "age-down"}>
              状态差 {ageDifference > 0 ? "+" : ""}{ageDifference.toFixed(1)} 岁
            </span>
            <span>把握度 {result.confidence} · {result.confidenceScore}/100</span>
          </div>
        </div>
        <div className="age-anchor">
          <span>主锚点</span>
          <strong>{anchor?.ageEquivalent?.toFixed(1)} 岁</strong>
          <p>{anchor?.value}</p>
          <small>FRIEND 同性别人群中位曲线插值</small>
        </div>
      </div>

      <details className="age-breakdown">
        <summary><span>查看年龄构成与详细贡献</span><small>{modifiers.length} 项修正因子 · {contexts.length} 项背景指标</small></summary>
        <div className="age-contribution-grid">
          {modifiers.map((item) => (
            <article key={item.id}>
              <div><span>{item.label}</span><strong className={item.yearAdjustment > 0 ? "age-up" : item.yearAdjustment < 0 ? "age-down" : ""}>
                {item.yearAdjustment > 0 ? "+" : ""}{item.yearAdjustment.toFixed(1)} 岁
              </strong></div>
              <p>{item.value}</p>
              <small>{item.explanation}</small>
              <em>{item.coverage} · 更新 {item.freshness}</em>
            </article>
          ))}
        </div>
        <div className="age-context-grid">
          {contexts.map((item) => (
            <article key={item.id}><span>{item.label}</span><strong>{item.value}</strong><p>{item.explanation}</p><small>{item.coverage}</small></article>
          ))}
        </div>
      </details>
      <p className="age-disclaimer">{result.disclaimer}</p>
    </section>
  );
}

function Dashboard({ dashboard, period, setPeriod, activeView, onNavigate }: {
  dashboard: DashboardPayload;
  period: PeriodDays;
  setPeriod: (period: PeriodDays) => void;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}) {
  const days = useMemo(
    () => dashboard.days.filter((day) => day.complete).sort((a, b) => a.date.localeCompare(b.date)),
    [dashboard.days],
  );
  const visible = days.slice(-period);
  const cards = useMemo(() => buildMetricCards(days, period), [days, period]);
  const insights = useMemo(() => deriveHealthInsights(days, period), [days, period]);
  const stateAge = useMemo(() => calculateStateAge(days, dashboard.profile), [days, dashboard.profile]);
  const sourceIds = new Set([...insights.flatMap((item) => item.sourceIds), ...stateAge.sourceIds]);
  const viewCopy: Record<AppView, { eyebrow: string; title: string; subtitle: string }> = {
    overview: { eyebrow: `${dashboard.importSummary?.lastCompleteDate ?? visible.at(-1)?.date} · 最近一次完整记录`, title: "今天，身体感觉怎么样？", subtitle: "先看结论，再决定今天该休息、保持，还是适度增加活动。" },
    insights: { eyebrow: `${period} 天提示`, title: "把异常讲清楚。", subtitle: "不只告诉你哪里变了，也展示同时发生了什么，以及下一步可以做什么。" },
    trends: { eyebrow: `${period} 天趋势`, title: "变化，比单次读数更重要。", subtitle: "把睡眠、心率、恢复、活动和生命体征放回时间中理解。" },
    "state-age": { eyebrow: "30 天长期状态", title: "身体状态，相当于多少岁？", subtitle: "查看心肺适能、恢复、活动与睡眠如何共同影响状态年龄。" },
    methodology: { eyebrow: "透明与安全", title: "每个结论，都有依据。", subtitle: "查看数据如何处理、模型如何计算，以及软件明确不做什么。" },
  };
  const currentCopy = viewCopy[activeView];

  const sharedGrid = { left: 42, right: 18, top: 38, bottom: 36 };
  const chartText = { color: "#7d838f", fontFamily: "Inter, 'PingFang SC', sans-serif" };
  const sleepOption = {
    animationDuration: 500,
    tooltip: { trigger: "axis" },
    grid: sharedGrid,
    xAxis: { type: "category", data: visible.map((day) => day.date.slice(5)), axisLabel: chartText, axisLine: { lineStyle: { color: "#e7e8eb" } } },
    yAxis: { type: "value", min: 0, max: 10, axisLabel: { ...chartText, formatter: "{value}h" }, splitLine: { lineStyle: { color: "#eff0f2" } } },
    series: [{ type: "bar", data: visible.map((day) => day.sleepHours ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("sleepHours", value) }, barMaxWidth: 18, itemStyle: { color: "#7458d8", borderRadius: [7, 7, 2, 2] }, markLine: { symbol: "none", label: { formatter: "7 小时", color: "#8f95a0" }, lineStyle: { color: "#b9bdc6", type: "dashed" }, data: [{ yAxis: 7 }] } }],
  };
  const heartOption = {
    animationDuration: 500,
    tooltip: { trigger: "axis" },
    legend: { data: ["静息心率", "HRV"], right: 16, textStyle: chartText },
    grid: sharedGrid,
    xAxis: { type: "category", data: visible.map((day) => day.date.slice(5)), axisLabel: chartText, axisLine: { lineStyle: { color: "#e7e8eb" } } },
    yAxis: [
      { type: "value", axisLabel: { ...chartText, formatter: "{value}" }, splitLine: { lineStyle: { color: "#eff0f2" } } },
      { type: "value", axisLabel: { ...chartText, formatter: "{value}ms" }, splitLine: { show: false } },
    ],
    series: [
      { name: "静息心率", type: "line", smooth: true, symbolSize: 5, data: visible.map((day) => day.restingHeartRate ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("restingHeartRate", value) }, lineStyle: { width: 2, color: "#ef596f" }, itemStyle: { color: "#ef596f" }, areaStyle: { color: "rgba(239,89,111,.08)" } },
      { name: "HRV", type: "line", yAxisIndex: 1, smooth: true, symbolSize: 5, data: visible.map((day) => day.heartRateVariability ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("heartRateVariability", value) }, lineStyle: { width: 2, color: "#3a9e8b" }, itemStyle: { color: "#3a9e8b" } },
    ],
  };
  const vitalOption = {
    animationDuration: 500,
    tooltip: { trigger: "axis" },
    legend: { data: ["血氧", "呼吸频率"], right: 16, textStyle: chartText },
    grid: sharedGrid,
    xAxis: { type: "category", data: visible.map((day) => day.date.slice(5)), axisLabel: chartText, axisLine: { lineStyle: { color: "#e7e8eb" } } },
    yAxis: [
      { type: "value", min: 85, max: 100, axisLabel: { ...chartText, formatter: "{value}%" }, splitLine: { lineStyle: { color: "#eff0f2" } } },
      { type: "value", min: 8, max: 24, axisLabel: { ...chartText, formatter: "{value}/分" }, splitLine: { show: false } },
    ],
    series: [
      { name: "血氧", type: "line", smooth: true, data: visible.map((day) => day.oxygenSaturation ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("oxygenSaturation", value) }, lineStyle: { width: 2, color: "#3979c7" }, itemStyle: { color: "#3979c7" } },
      { name: "呼吸频率", type: "line", yAxisIndex: 1, smooth: true, data: visible.map((day) => day.respiratoryRate ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("respiratoryRate", value) }, lineStyle: { width: 2, color: "#d4863a" }, itemStyle: { color: "#d4863a" } },
    ],
  };
  const fitnessOption = {
    animationDuration: 500,
    tooltip: { trigger: "axis" },
    legend: { data: ["VO₂ max", "一分钟心率恢复"], right: 16, textStyle: chartText },
    grid: sharedGrid,
    xAxis: { type: "category", data: visible.map((day) => day.date.slice(5)), axisLabel: chartText, axisLine: { lineStyle: { color: "#e7e8eb" } } },
    yAxis: [
      { type: "value", name: "ml/kg/min", nameTextStyle: chartText, axisLabel: chartText, splitLine: { lineStyle: { color: "#eff0f2" } } },
      { type: "value", name: "bpm", nameTextStyle: chartText, axisLabel: chartText, splitLine: { show: false } },
    ],
    series: [
      { name: "VO₂ max", type: "line", connectNulls: true, smooth: true, symbolSize: 6, data: visible.map((day) => day.vo2Max ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("vo2Max", value) }, lineStyle: { width: 2, color: "#6651c7" }, itemStyle: { color: "#6651c7" }, areaStyle: { color: "rgba(102,81,199,.08)" } },
      { name: "一分钟心率恢复", type: "scatter", yAxisIndex: 1, symbolSize: 8, data: visible.map((day) => day.heartRateRecoveryOneMinute ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("heartRateRecoveryOneMinute", value) }, itemStyle: { color: "#2d9b82" } },
    ],
  };
  const energyOption = {
    animationDuration: 500,
    tooltip: { trigger: "axis" },
    legend: { data: ["活动能量", "静息能量", "日照"], right: 16, textStyle: chartText },
    grid: sharedGrid,
    xAxis: { type: "category", data: visible.map((day) => day.date.slice(5)), axisLabel: chartText, axisLine: { lineStyle: { color: "#e7e8eb" } } },
    yAxis: [
      { type: "value", name: "千卡", nameTextStyle: chartText, axisLabel: chartText, splitLine: { lineStyle: { color: "#eff0f2" } } },
      { type: "value", name: "分钟", nameTextStyle: chartText, axisLabel: chartText, splitLine: { show: false } },
    ],
    series: [
      { name: "活动能量", type: "bar", barMaxWidth: 12, data: visible.map((day) => day.activeEnergyKcal ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("activeEnergyKcal", value) }, itemStyle: { color: "#ef6a74", borderRadius: [4, 4, 0, 0] } },
      { name: "静息能量", type: "bar", barMaxWidth: 12, data: visible.map((day) => day.basalEnergyKcal ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("basalEnergyKcal", value) }, itemStyle: { color: "#e9b45d", borderRadius: [4, 4, 0, 0] } },
      { name: "日照", type: "line", yAxisIndex: 1, connectNulls: true, smooth: true, symbolSize: 4, data: visible.map((day) => day.timeInDaylightMinutes ?? null), tooltip: { valueFormatter: (value: unknown) => formatHealthMetric("timeInDaylightMinutes", value) }, lineStyle: { width: 2, color: "#4c9fbe" }, itemStyle: { color: "#4c9fbe" } },
    ],
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">{currentCopy.eyebrow}</p>
          <h1>{currentCopy.title}</h1>
          <p className="topbar-subtitle">{currentCopy.subtitle}</p>
        </div>
        {(activeView === "overview" || activeView === "insights" || activeView === "trends") && <div className="topbar-actions">
          <div className="period-switch" aria-label="分析周期">
            <button className={period === 7 ? "active" : ""} onClick={() => setPeriod(7)}>近 7 天</button>
            <button className={period === 30 ? "active" : ""} onClick={() => setPeriod(30)}>近 30 天</button>
          </div>
        </div>}
      </header>

      <main className="dashboard-content">
        {activeView === "overview" && <>
          <DailyBrief days={days} insights={insights} />
          <HealthMonitor days={days} />
          <StateAgePreview result={stateAge} onOpen={() => onNavigate("state-age")} />
          <section className="period-summary">
            <div className="section-heading compact-heading">
              <div><p className="eyebrow">周期概览</p><h2>{period} 天关键指标</h2></div>
              <p>当前周期均值与上一周期变化</p>
            </div>
            <div className="metric-grid">
              {cards.map((card) => (
                <article className={`metric-card tone-${card.tone}`} key={card.key}>
                  <span>{card.label}</span>
                  <div><strong>{card.value}</strong><small>{card.unit}</small></div>
                  <p>{card.delta ?? "等待上一周期对照"}</p>
                  <em>覆盖 {card.coverage}</em>
                </article>
              ))}
            </div>
          </section>
        </>}

        {activeView === "insights" && <>
          <section className="view-intro"><strong>{insights.length}</strong><div><h2>条近期提示</h2><p>严重度来自多项证据组合，而不是一次读数。</p></div></section>
          <section className="insight-list">{insights.map((item) => <InsightCard insight={item} key={item.id} />)}</section>
          <section className="safety-card"><Icon name="shield" /><p><strong>安全边界</strong>{SAFETY_COPY.nonDiagnosis} {SAFETY_COPY.emergency}</p></section>
        </>}

        {activeView === "trends" && <section className="chart-grid view-chart-grid">
          <article className="chart-card"><h3>睡眠时长</h3><ReactECharts option={sleepOption} style={{ height: 310 }} /></article>
          <article className="chart-card"><h3>心率与恢复</h3><ReactECharts option={heartOption} style={{ height: 310 }} /></article>
          <article className="chart-card"><h3>心肺适能与运动后恢复</h3><ReactECharts option={fitnessOption} style={{ height: 310 }} /></article>
          <article className="chart-card"><h3>活动、静息能量与日照</h3><ReactECharts option={energyOption} style={{ height: 310 }} /></article>
          <article className="chart-card chart-wide"><h3>血氧与呼吸趋势</h3><ReactECharts option={vitalOption} style={{ height: 310 }} /></article>
          <p className="chart-footnote">图表只用于观察个人变化；参考线不是诊断阈值。</p>
        </section>}

        {activeView === "state-age" && <StateAgePanel result={stateAge} />}

        {activeView === "methodology" && <>
          <section className="method-card">
            <div><Icon name="book" /><div><p className="eyebrow">方法与出处</p><h2>每条解释都能追溯</h2></div></div>
            <p>异常提示采用最近 28 个完整日的中位数与 MAD。状态年龄只把 FRIEND 大样本用于 VO₂ max 心肺适能锚点，其余数据采用透明、封顶的小幅修正；0.1 岁是显示分辨率，不代表医学准确度。</p>
            <div className="source-list">
              {KNOWLEDGE_SOURCES.filter((source) => sourceIds.has(source.id)).map((source) => (
                <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><strong>{source.organization}</strong><span>{source.title}</span><small>{source.use}</small></a>
              ))}
            </div>
          </section>
          <section className="safety-card"><Icon name="shield" /><p><strong>安全边界</strong>{SAFETY_COPY.nonDiagnosis} {SAFETY_COPY.emergency}</p></section>
        </>}
      </main>
    </>
  );
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload>(EMPTY_DASHBOARD);
  const [period, setPeriod] = useState<PeriodDays>(7);
  const [activeView, setActiveView] = useState<AppView>("overview");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = await invoke<DashboardPayload>("load_dashboard");
    setDashboard(payload);
  }, []);

  const importPath = useCallback(async (path: string) => {
    if (!isTauri()) {
      setError("当前是浏览器预览。请运行桌面版后导入 ZIP；浏览器预览不会读取你的健康文件。");
      return;
    }
    setError(null);
    setProgress({ phase: "validating", percent: 1, message: "正在验证压缩包" });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const payload = await invoke<DashboardPayload>("import_health_export", { path });
      setDashboard(payload);
      setActiveView("overview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgress(null);
    }
  }, []);

  const chooseImport = useCallback(async () => {
    if (!isTauri()) {
      setError("当前是浏览器预览。桌面后端启动后，这里会打开系统文件选择器。");
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, directory: false, filters: [{ name: "Apple 健康导出", extensions: ["zip"] }] });
    if (typeof path === "string") await importPath(path);
  }, [importPath]);

  useEffect(() => {
    loadDashboard().catch((cause) => setError(String(cause)));
    if (!isTauri()) return;
    let removeProgress: (() => void) | undefined;
    let removeDrag: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      removeProgress = await listen<ImportProgress>("import-progress", (event) => setProgress(event.payload));
      removeDrag = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === "over") setDragActive(true);
        if (event.payload.type === "leave") setDragActive(false);
        if (event.payload.type === "drop") {
          setDragActive(false);
          const zip = event.payload.paths.find((path) => path.toLowerCase().endsWith(".zip"));
          if (zip) void importPath(zip);
          else setError("请拖入 Apple 健康导出的 ZIP 压缩包。");
        }
      });
    })().catch((cause) => setError(String(cause)));
    return () => { removeProgress?.(); removeDrag?.(); };
  }, [importPath, loadDashboard]);

  return (
    <div className="app-shell">
      <header className="app-navigation">
        <div className="app-navigation-inner">
          <button className="brand brand-button" onClick={() => setActiveView("overview")}>
            <span><Icon name="heart" /></span><strong>知衡健康</strong>
          </button>
          <nav aria-label="主导航">
            <button className={activeView === "overview" ? "active" : ""} onClick={() => setActiveView("overview")}>概览</button>
            <button className={activeView === "insights" ? "active" : ""} onClick={() => setActiveView("insights")}>提示</button>
            <button className={activeView === "trends" ? "active" : ""} onClick={() => setActiveView("trends")}>趋势</button>
            <button className={activeView === "state-age" ? "active" : ""} onClick={() => setActiveView("state-age")}>状态年龄</button>
            <button className={activeView === "methodology" ? "active" : ""} onClick={() => setActiveView("methodology")}>方法与隐私</button>
          </nav>
          <div className="navigation-actions">
            <span className="privacy-indicator"><i />仅本机</span>
            <button className="nav-import-button" onClick={chooseImport}><Icon name="import" />导入健康数据</button>
          </div>
        </div>
      </header>
      <div className="main-pane">
        {error && <div className="error-toast"><strong>暂时无法继续</strong><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}
        {dashboard.days.length ? <Dashboard dashboard={dashboard} period={period} setPeriod={setPeriod} activeView={activeView} onNavigate={setActiveView} /> : <EmptyState onImport={chooseImport} dragActive={dragActive} />}
      </div>
      {progress && <ImportOverlay progress={progress} />}
    </div>
  );
}
