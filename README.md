<div align="center">
  <img src="src-tauri/icons/icon.png" width="112" alt="知衡健康图标" />
  <h1>知衡健康 · ZhiHeng Health</h1>
  <p><strong>把 Apple 健康导出，变成可解释、可追溯、只留在本机的个人趋势报告。</strong></p>
  <p>Windows · Tauri 2 · Rust · React · TypeScript · SQLite · ECharts</p>
</div>

> 参赛展示版本：`v1.3.2`。本项目用于个人健康数据整理与趋势沟通，不提供医学诊断，也不能替代医生。

## 为什么做这个项目

Apple 健康可以积累大量睡眠、心率、HRV、活动、血氧和锻炼记录，但原始导出是体积很大的 XML/ZIP：普通用户很难持续比较，更难理解多个指标是否在同一时间发生变化。

知衡健康把这条流程做成一个离线 Windows 桌面应用：导入 Apple 健康 ZIP，增量写入本地数据库，建立个人基线，再用透明规则解释“发生了什么、证据有多强、下一步可以做什么”。

## 核心亮点

- **隐私优先**：没有账号、云端上传或遥测；健康数据默认只写入本机应用数据目录。
- **大文件流式导入**：Rust 直接读取 ZIP/XML，不把完整 XML 装入内存，也不把健康 XML 解压到临时目录。
- **安全的重复导入**：稳定指纹去重与 SQLite 事务写入，适合定期导入 Apple 健康完整快照。
- **个人基线而非人群贴标签**：以滚动中位数、MAD/IQR 和数据覆盖判断“是否偏离本人近期范围”。
- **多指标交叉验证**：把心率事件与睡眠、锻炼、HRV、呼吸、血氧和腕温放到同一时间上下文中。
- **可解释结论**：同时显示证据、缺失项、把握度、可能解释、行动建议和医学边界。
- **数据控制权**：支持本地 CSV 导出、按日期/指标删除和清空全部健康数据。

## 三分钟体验

1. 从本仓库右侧 **Releases** 下载 `知衡健康_1.3.2_Windows_x64_离线安装包.exe`。
2. 在 iPhone“健康”App 中依次进入头像 → “导出所有健康数据”。
3. 在知衡健康中选择或拖入导出的 ZIP。
4. 查看“每日、洞察、建议、数据、设置”五个页面，并切换日期与 7/30/90/180/365 天窗口。

安装包内置 WebView2 离线运行时；当前未购买商业代码签名证书，因此 Windows SmartScreen 可能提示“未知发布者”。发布文件的 SHA-256 记录在 [`release/SHA256.txt`](release/SHA256.txt)。更完整的演示脚本见 [`docs/HACKATHON_DEMO.md`](docs/HACKATHON_DEMO.md)。

## 工作方式

```mermaid
flowchart LR
    A["Apple 健康 ZIP / export.xml"] --> B["Rust 安全校验与流式解析"]
    B --> C["SQLite 事务写入与指纹去重"]
    C --> D["逐日聚合与数据覆盖计算"]
    D --> E["个人基线与多指标交叉验证"]
    E --> F["React 桌面报告与本地数据控制"]
```

导入层检查 ZIP 路径穿越、符号链接、条目数、展开体积和异常压缩比；分析层不填补缺失健康读数，也不会把单次腕部设备读数升级为诊断。

## 已支持的分析

- 睡眠时长、睡眠阶段和作息稳定性；
- 静息心率、心率范围、HRV 与一分钟心率恢复；
- 步数、锻炼时长、活动/静息能量与 VO₂ max；
- 呼吸频率、血氧与腕温趋势；
- 高/低心率事件与睡眠、锻炼区间的时间重叠；
- ECG 导出摘要（只保留日期、Apple 分类、症状和来源文件，不保存姓名或出生日期）；
- 7/30/90/180/365 天趋势、个人基线偏离和“状态年龄”解释模型。

状态年龄是近期体能与恢复的可解释指数，不是生物学年龄、寿命预测或疾病诊断。公式、封顶规则和误差边界见 [`docs/STATE_AGE_MODEL.md`](docs/STATE_AGE_MODEL.md)。

## 技术架构

| 层 | 技术 | 责任 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 | 本机窗口、文件选择、拖放、事件和安装包 |
| 数据处理 | Rust | ZIP/XML/ECG 解析、安全限制、事务与逐日聚合 |
| 存储 | SQLite | 原始记录、导入摘要、指纹去重和本地删除 |
| 界面 | React + TypeScript | 每日报告、趋势、解释、数据覆盖和本地控制 |
| 图表 | ECharts | 多时间窗口趋势和缺失数据断点 |

源码结构：

```text
src/                  React 界面、分析规则与前端单元测试
src-tauri/src/        Rust 导入、数据库和聚合逻辑
src-tauri/resources/  Windows 运行时依赖
docs/                 模型、安全、发布和黑客松说明
scripts/              可复用的工作区维护命令
release/              只提交校验文件；安装包放 GitHub Releases
```

## 本地开发

要求：Node.js 20+、Rust stable、Windows WebView2，以及包含“使用 C++ 的桌面开发”和 Windows SDK 的 Visual Studio 2022 Build Tools。

```powershell
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri -- dev
```

生成 Windows NSIS 安装包：

```powershell
npm run tauri -- build
```

`npm run build` 只验证前端生产资源；最终桌面程序必须通过 Tauri 构建。任务结束可运行 `npm run clean:workspace` 删除可重建的依赖、缓存与构建产物。

## 隐私与医疗安全

- 仓库不包含真实 Apple 健康导出、数据库或个人试算结果；测试使用人工构造数据。
- 原 ZIP 只读访问；ECG 姓名和出生日期字段会被忽略。
- 精确出生日期只在导入内存中用于计算当前年龄，数据库不保存出生日期。
- 当前版本无上传接口、账号系统或遥测；界面中的权威资料链接仅在用户主动打开时访问网络。
- 软件不重新解释 ECG 波形，不建议自行停药或改药；紧急症状应直接联系当地急救服务。

详细规则见 [`docs/CROSS_VALIDATION_RULES.md`](docs/CROSS_VALIDATION_RULES.md) 与 [`docs/PRODUCT_SAFETY_PLAN.md`](docs/PRODUCT_SAFETY_PLAN.md)。

## 验证状态

- 前端 5 个测试文件、20 项单元测试通过；
- Rust 导入与聚合单元测试通过；
- TypeScript 生产构建通过；
- Windows x64 NSIS 离线安装、卸载、重新安装与首次启动已验证；
- `v1.3.2` 安装包 SHA-256：`C6E75F7374E2D1396E7CFA59AEB18309A3FB4A221BCC0D24547AC0B6095416F4`。

完整记录见 [`docs/WINDOWS_RELEASE.md`](docs/WINDOWS_RELEASE.md)。

## 已知边界

- 当前只发布并实测 Windows x64；
- 安装包尚未进行商业代码签名；
- 尚未在独立的纯净 Windows 10/11 虚拟机矩阵逐台测试；
- 设备数据的缺失、佩戴方式和传感器误差会限制结论强度；
- 状态年龄和异常提示均为趋势沟通工具，不是医疗器械结论。

## 项目资料

- [`docs/HACKATHON_DEMO.md`](docs/HACKATHON_DEMO.md)：黑客松展示脚本与评委问答
- [`docs/PRODUCT_SAFETY_PLAN.md`](docs/PRODUCT_SAFETY_PLAN.md)：产品、算法与医学安全方案
- [`docs/CROSS_VALIDATION_RULES.md`](docs/CROSS_VALIDATION_RULES.md)：多指标交叉验证规则
- [`docs/STATE_AGE_MODEL.md`](docs/STATE_AGE_MODEL.md)：状态年龄模型
- [`docs/V3_PRODUCT_ARCHITECTURE.md`](docs/V3_PRODUCT_ARCHITECTURE.md)：桌面产品架构
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md)：GitHub 首次发布步骤

## 许可证

当前仓库尚未声明开源许可证。在作者选择许可证前，代码默认不授予复制、修改或再分发许可。
