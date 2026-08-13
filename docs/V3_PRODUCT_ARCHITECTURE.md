# 知衡健康 V3：桌面健康报告架构

## 1. 当前项目结构检查

- 桌面壳层：Tauri 2，Windows NSIS 离线安装。
- 前端：React 19、TypeScript、Vite、ECharts；当前入口集中在 `src/App.tsx`，需要拆分页面和基础组件。
- 数据导入：Rust 直接流式读取 Apple 健康 `export.zip`，支持指纹去重、重复导入和 SQLite 增量更新。
- 本地数据库：`imports`、`health_records`、`ecg_summaries`、`profile_context`。原始记录保留类型、数值、单位、起止时间、来源设备和 metadata。
- 确定性分析：Rust 完成逐日聚合；TypeScript 使用滚动中位数和 MAD 做个人基线、跨指标提示与状态年龄。
- 当前缺口：页面按概览/提示/趋势组织，不符合每日/洞察/建议；日期不可自由切换；来源、样本数、稀疏性和缺失原因展示不足；部分 HealthKit 类型尚未进入逐日聚合。

## 2. 素材包视觉语言提取

Vetric 只作为视觉母版，不复制品牌、营销文案和网页长滚动布局。

- 画布：近白 `#F7F8FA`，内容面 `#FFFFFF`，主文字 `#090A1E`，弱文字 `#697080`。
- 强调色：蓝 `#2867F0`、粉 `#F653B7`、黄 `#F2BE3E`、绿 `#53B94C`；使用 8%–14% 的浅色面，不使用彩色大面积渐变图表。
- 组件：1px 冷灰描边、18–28px 圆角、极轻阴影、大数字、短标签、充足内边距。
- 排版：中文使用系统无衬线；报告标题可使用宋体回退形成克制的编辑感，但数据、控件和正文保持无衬线。
- 桌面节奏：固定导航，内容区内分栏；页面切换 240ms，卡片状态 180ms，图表 600ms；支持 `prefers-reduced-motion`。
- 禁止：营销 Hero、无限长单页、持续漂浮、强弹跳、医院监护仪式荧光、装饰性图表。

## 3. 页面信息架构

一级导航固定为：

1. 每日：指定日期的身体报告，顺序为状态总览、睡眠、恢复、心率、活动、生命体征、数据质量。
2. 洞察：7/30/90/180/365 天窗口，优先展示变化事实、熬夜成本、趋势和关联边界。
3. 建议：最多三项结构化行动，展示个人数据依据、证据等级、周期、观察指标、停止条件和就医边界。
4. 数据：导入记录、覆盖范围、HealthKit 类型、设备来源、缺失与数据质量。
5. 设置：本地优先状态、分析方法、证据库、未来同步边界。

顶部状态栏在所有页面保留：上一天、下一天、返回今天、原生日期选择、完整度、设备来源、最后更新和导入入口。

## 4. HealthKit 数据类型映射

| 产品指标 | HealthKit 标识 | 聚合方式 | 数据来源提示 |
|---|---|---|---|
| 睡眠阶段 | `HKCategoryTypeIdentifierSleepAnalysis` | 区间去重后按 Awake/REM/Core/Deep/InBed 汇总 | Apple Watch / iPhone / 第三方睡眠应用 |
| 心率 | `HKQuantityTypeIdentifierHeartRate` | 分时样本；日最低/最高/中位数 | 通常 Apple Watch |
| 静息心率 | `HKQuantityTypeIdentifierRestingHeartRate` | 日均值，趋势用中位数 | Apple Watch 推导 |
| HRV | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | 日均值；个人滚动基线 | Apple Health 的 SDNN，不等同 24h ECG |
| 步行平均心率 | `HKQuantityTypeIdentifierWalkingHeartRateAverage` | 日均值 | Apple Watch 推导 |
| 心率恢复 | `HKQuantityTypeIdentifierHeartRateRecoveryOneMinute` | 日中位数 | 运动后估算 |
| 呼吸频率 | `HKQuantityTypeIdentifierRespiratoryRate` | 日均值；睡眠语境解释 | 多为睡眠期估算 |
| 血氧 | `HKQuantityTypeIdentifierOxygenSaturation` | 百分比归一化后中位数 | 受机型、地区和测量条件限制 |
| 腕温 | `HKQuantityTypeIdentifierAppleSleepingWristTemperature` | 相对个人中位数偏移 | 不是核心体温 |
| VO₂ max | `HKQuantityTypeIdentifierVO2Max` | 日中位数 | Apple 心肺适能估算 |
| 活动/静息能量 | `ActiveEnergyBurned` / `BasalEnergyBurned` | 单位转为 kcal 后求和 | 设备算法估算 |
| 步数/距离/楼层 | `StepCount` / `DistanceWalkingRunning` / `FlightsClimbed` | 日求和 | iPhone 与 Watch 可共同写入 |
| 运动/站立 | `AppleExerciseTime` / `AppleStandTime` | 日求和 | Apple Watch 活动记录 |
| 移动能力 | `WalkingSpeed`、`WalkingStepLength`、`WalkingAsymmetryPercentage`、`WalkingDoubleSupportPercentage`、`StairAscentSpeed`、`StairDescentSpeed` | 日中位数 | 可能主要来自 iPhone，必须展示来源 |
| 日照 | `TimeInDaylight` | 日求和 | 支持设备估算 |
| 心率通知 | High/Low/Irregular Rhythm category | 事件计数并与睡眠/运动区间对齐 | 通知不是诊断 |

未知类型继续保留在 `health_records`，不丢弃；没有足够样本时不生成连续趋势。

## 5. 本地数据库结构

现有通用原始表保持不变，新增逻辑层而非破坏迁移：

- `health_records`：不可变原始记录，`fingerprint` 去重。
- `daily_notes`：日期、主观精力、压力、专注、情绪、咖啡因、饮酒、不适、旅行和标签。
- `analysis_snapshots`：规则版本、窗口、输入覆盖、结果 JSON、生成时间。
- `health_rules`：规则 ID、版本、输入、触发/排除条件、风险级别、证据 ID、审核状态。
- `evidence_sources`：证据元数据、等级、适用人群、标识符、检索和复核日期。
- `user_preferences`：目标作息、日期/单位偏好、同步开关；云同步默认关闭。

本轮先保持向后兼容，并在逐日负载中补充来源、样本数与更多指标；后续敏感字段加密采用系统密钥环管理数据库密钥。

## 6. 组件拆分

- `DesktopShell`：侧栏、状态栏、页面容器、全局导入与错误状态。
- `DateNavigator`：日期选择、前后切换、今日返回和可用日期约束。
- `DailyPage`：报告摘要、状态矩阵、睡眠、恢复、活动、生命体征与质量。
- `InsightsPage`：窗口筛选、洞察卡、熬夜成本、趋势图。
- `AdvicePage`：结构化建议卡与证据抽屉。
- `DataPage`：导入、覆盖、来源、类型映射与空状态。
- `SettingsPage`：本地优先、方法与隐私边界。
- `MetricTile`、`SignalRow`、`EvidenceBadge`、`EmptyMetric`、`ChartPanel`：共享基础组件。

## 7. 动效规范

- 页面进入：透明度 0→1、Y 6px→0，240ms ease-out。
- 日期切换：按方向 X ±8px，220ms；减少动态时仅切换透明度。
- 卡片 hover：描边和阴影 180ms，不移动超过 2px。
- 图表：600ms cubic-out；稀疏数据使用点，不启用平滑插值。
- 展开详情：高度与透明度 200ms；焦点环始终可见。

## 8. 健康分析规则结构

规则执行顺序：数据质量门 → 个人基线 → 单指标偏离 → 同日多指标组合 → 时段上下文 → 风险动作。

```ts
interface HealthRule {
  id: string;
  version: string;
  inputs: string[];
  minimumCoverage: Record<string, number>;
  evaluate(context: DeterministicContext): RuleResult | null;
  exclusions: string[];
  severity: "lifestyle" | "attention" | "clinical-review";
  evidenceIds: string[];
  reviewed: boolean;
}
```

没有达到覆盖门槛时只返回 `insufficient-data`；医疗风险规则必须 `reviewed=true`，语言层不能创建新阈值。

## 9. 证据资料数据结构

每条建议至少绑定两条独立证据，其中至少一条为 A/B 级。

```ts
interface EvidenceSource {
  id: string;
  title: string;
  organization: string;
  year: number;
  grade: "A" | "B" | "C" | "D";
  population: string;
  studyDesign: string;
  sampleSize?: string;
  finding: string;
  limitations: string;
  conflicts?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  officialUrl?: string;
  retrievedAt: string;
  verifiedAt: string;
}
```

## 10. 开发任务拆分与图表契约

1. 扩展 Rust 聚合：睡眠阶段、日心率、步行心率、距离/站立/楼层/步态、来源和样本数。
2. 建立日期级确定性派生：数据完整度、睡眠规律性、睡眠债务、熬夜识别、恢复组合。
3. 重做桌面壳层和五个一级页面。
4. 接入图表交互、缺失状态、模拟测试夹具。
5. 验证真实导入、构建、安装和窗口响应。

图表契约：

| 区域 | 问题 | 图形 | 数据要求 | 不足时降级 |
|---|---|---|---|---|
| 睡眠阶段 | 昨夜各阶段如何分布 | 区间时间轴 | 真实起止时间 | 仅显示阶段汇总和“缺少分时数据” |
| 恢复趋势 | RHR 与 HRV 是否共同偏离 | 双图共享日期轴，不共享数值轴 | 至少 8 个有效日 | KPI 与基线区间 |
| 活动趋势 | 负荷和恢复是否匹配 | 分面柱/线 | 至少 8 个有效日 | 7/28 天汇总 |
| 关联分析 | 两指标是否同向变化 | 散点 | 至少 12 对，少于 8 不生成 | 显示有效配对数和不足原因 |

所有图表使用明确单位、样本数、日期窗口和来源；颜色按指标语义，不按数值正负机械映射。
