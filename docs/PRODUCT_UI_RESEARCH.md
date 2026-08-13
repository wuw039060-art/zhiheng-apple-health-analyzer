# 健康应用功能展示调研与界面决策

调研日期：2026-07-17

## 参考产品

### Apple 健康

Apple 把首页信息分为 Highlights、Trends 和详细健康分类。Highlights 负责解释近期值得注意的变化；Trend 显示变化幅度与持续时间；用户再进入单项指标查看周、月、年视图。

- Apple Support：<https://support.apple.com/guide/iphone/view-health-data-iphe3d379c32/ios>
- Apple Trends 说明：<https://www.apple.com/newsroom/2021/06/apple-advances-personal-health-by-introducing-secure-sharing-and-new-insights/>

### WHOOP

WHOOP 首页把 Sleep、Recovery、Strain 三项核心状态放在最上方，再给 Health Monitor、日程和建议。Recovery 使用 HRV、静息心率、睡眠表现和呼吸频率等信号，并用绿、黄、红区表示行动强度，而不是直接把单项读数诊断化。

- WHOOP Home Screen：<https://www.whoop.com/au/pt/thelocker/the-all-new-whoop-home-screen/>
- WHOOP Recovery：<https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/>
- WHOOP Healthspan：<https://www.whoop.com/us/en/product-feature/>

### Oura

Oura 先显示 Readiness、Sleep、Activity 三类分数，再通过 Contributors 解释分数由哪些因素形成。贡献因子基于个人平均值，短期信号和长期平衡被分开表达，详情页才展示完整解释。

- Oura Readiness：<https://support.ouraring.com/hc/en-us/articles/360025589793-Readiness-Score>
- Oura Readiness Contributors：<https://support.ouraring.com/hc/en-us/articles/360057791533-Readiness-Contributors>

### Garmin Connect

Garmin 首页采用 Today’s Activity、In Focus、At a Glance 等层级；用户可以定制优先指标。Body Battery 把活动、压力、休息和睡眠组合成可行动的能量视角，同时保留单项健康统计入口。

- Garmin Connect 新首页：<https://www.garmin.com/en-US/newsroom/press-release/wearables-health/garmin-connect-gets-a-new-look-simplified-design-provides-a-more-customized-experience/>
- Garmin Connect App：<https://ph.garmin.com/products/apps/garmin-connect-mobile/>
- Body Battery：<https://www.garmin.com/tr-TR/garmin-technology/health-science/body-battery/>

## 共同设计规律

1. 首页先回答“我今天怎么样”和“我现在该做什么”，而不是先展示方法学。
2. 使用 3–5 个核心支柱建立稳定心智模型，其余指标进入 At a Glance 或详情页。
3. 综合结论必须能展开查看贡献因子，避免黑盒分数。
4. 异常先与个人基线比较，再结合其他信号解释；单次读数不直接给诊断。
5. 今日状态、近期趋势和长期能力分层呈现，避免把短期波动误当作长期变化。
6. 颜色表达行动优先级：绿色表示个人范围，黄色表示留意，红色只用于高优先级提示。

## 已落实到知衡健康

- 新增“今日状态摘要”，把最高优先级提示和第一条行动建议放到首页首屏；
- 新增睡眠、恢复、活动三大支柱，不额外制造未经验证的综合医学分数；
- 新增生命体征 Health Monitor，显示静息心率、HRV、呼吸、血氧和腕温与个人基线的关系；
- 状态年龄使用大号圆环呈现，把握度作为圆环进度，避免用动画暗示虚假精确度；
- 年龄贡献因子和背景指标默认收起，仍可完整展开审查；
- 把周期均值、异常解释、趋势、年龄模型和方法出处分成明确层级；
- 左侧导航可直接跳转到提示、趋势、状态年龄和方法说明。

## 没有照搬的部分

- 没有直接复制 WHOOP/Oura 的 0–100 Recovery 或 Readiness 分数，因为 Apple 健康导出数据的采样完整性与设备佩戴情况会影响结果；
- 没有把状态年龄当作医学诊断年龄，仍显示波动区间、把握度、数据覆盖和模型边界；
- 没有加入社交排行、挑战或付费教练模块，保持本机隐私和个人健康分析定位。

## 1.2.0 Apple 官方设计原则修正

第二轮没有继续增加竞品卡片，而是回到 Apple 官方 Human Interface Guidelines：

- Design principles：<https://developer.apple.com/design/human-interface-guidelines/design-principles>
- Materials：<https://developer.apple.com/design/human-interface-guidelines/materials>
- Color：<https://developer.apple.com/design/human-interface-guidelines/color>
- Typography：<https://developer.apple.com/design/human-interface-guidelines/typography>
- Layout：<https://developer.apple.com/design/human-interface-guidelines/layout>

对应修正：

1. Simplicity：删除无明确任务的栏目、重复导入按钮和技术状态横幅。
2. Hierarchy：每个主导航只显示一个任务视图，概览不再包含所有详情。
3. Materials：半透明材质只用于顶部导航，内容卡片使用安静的实色背景。
4. Color：系统蓝只用于主操作和当前选择；绿、橙、红只表示健康状态。
5. Typography：提高正文、指标和标题字号，减少 8–10px 的难读说明文字。
6. Responsibility：所有异常、状态年龄和行动建议继续显示数据边界与非诊断声明。
